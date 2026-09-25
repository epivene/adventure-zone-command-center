import { db } from "@workspace/db";
import { createProductionOutreachAllocation } from "../outreach-planner/production-outreach-allocation";
import { createOwnedVisualReader } from "./visual-reader";
import { RunStore } from "./run-store";
import { DocumentExtractionStore } from "./document-extraction-store";
import {
  documentSourceMetadata,
  assertAttachmentScope,
} from "./document-source-access";
import { readModelConfig } from "./model-config";
import type { Pool } from "pg";
import type { RunContext, Evidence } from "./contracts";
import type { ReadDependencies } from "./read-tools";
import { result, blocked } from "./read-tools";
import { PostgresProfileSearchRepository } from "../assistant/profile-search-repository";
import { BusinessDocumentService } from "../business-documents/business-document-service";
import { BusinessDocumentRepository } from "../business-documents/business-document-repository";
import { BusinessDocumentStorage } from "../business-documents/business-document-storage";
import { PostgresGoogleConnectionRepository } from "../google-workspace/google-connection-repository";
import { DocumentReader } from "./document-reader";
export function productionReads(
  pool: Pool,
  ownerId: string,
  google: PostgresGoogleConnectionRepository,
) {
  let documentService: BusinessDocumentService | undefined;
  const documents = () => (documentService ??= new BusinessDocumentService());
  const files = new BusinessDocumentRepository();
  let documentStorage: BusinessDocumentStorage | undefined;
  const storage = () => (documentStorage ??= new BusinessDocumentStorage());
  const gmail: ReadDependencies["gmail"] = async () => {
    const before = await google.getCurrent();
    if (!before) return null;
    const client = await google.createReadClient();
    const after = await google.getCurrent();
    if (!client || after?.id !== before.id)
      throw new Error("ASSISTANT_CONNECTION_CHANGED");
    return { connectionId: before.id, client };
  };
  const profile = async (id: string) => {
    const r = await pool.query(
      `SELECT * FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
    return r.rows[0];
  };
  const evidence = (
    id: string,
    kind: Evidence["kind"],
    data: unknown,
    complete = true,
    version: string | null = null,
  ): Evidence => ({
    id,
    kind,
    recordId: id,
    eventYear: null,
    occurredAt: null,
    retrievedAt: new Date().toISOString(),
    version,
    complete,
    text: JSON.stringify(data),
  });
  const reader = new DocumentReader({
    ownerId,
    cache: new DocumentExtractionStore(pool),
    visualExtract: createOwnedVisualReader(
      readModelConfig(process.env),
      new RunStore(pool),
    ),
    load: async (context, source) => {
      if ("documentId" in source) {
        const metadata = await documentSourceMetadata(
          pool,
          context,
          source.documentId,
        );
        const file = await files.getOpenableFile(source.documentId);
        if (!file) throw new Error("ASSISTANT_DOCUMENT_UNAVAILABLE");
        return {
          bytes: await storage().get(file.storageKey),
          recordId: source.documentId,
          eventYear: metadata.eventYear,
        };
      }
      const connection = await gmail(context);
      if (
        !connection ||
        connection.connectionId !== context.actor.connectionId ||
        !connection.client.getAttachment
      )
        throw new Error("ASSISTANT_CONNECTION_CHANGED");
      await assertAttachmentScope(
        pool,
        context,
        source,
        connection.client,
        connection.connectionId,
      );
      const bytes = await connection.client.getAttachment(source);
      if ((await google.getCurrent())?.id !== connection.connectionId)
        throw new Error("ASSISTANT_CONNECTION_CHANGED");
      return {
        bytes,
        recordId: `${connection.connectionId}:${source.messageId}:${source.attachmentId}`,
        eventYear: null,
      };
    },
  });
  const adapters: ReadDependencies["adapters"] = {
    search_profiles: async (_c, a) =>
      result(
        await new PostgresProfileSearchRepository(pool).search({
          query: a.query,
          limit: 20,
        }),
      ),
    read_profile_history: async (_c, a) => {
      const organization = await profile(a.organizationId);
      const [contacts, bookings, activities] = await Promise.all([
        pool.query(
          `SELECT c.* FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE oc.organization_id=$1 AND oc.active=true ORDER BY c.id`,
          [a.organizationId],
        ),
        pool.query(
          `SELECT * FROM bookings WHERE organization_id=$1 ORDER BY starts_at DESC NULLS LAST,id`,
          [a.organizationId],
        ),
        pool.query(
          `SELECT id,kind,subject,body,occurred_at,source_type FROM activities WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY timeline_sort_at DESC,id LIMIT 501 OFFSET $2`,
          [a.organizationId, a.offset ?? 0],
        ),
      ]);
      const complete = activities.rows.length <= 500;
      const data = {
        organization,
        contacts: contacts.rows,
        bookings: bookings.rows,
        activities: activities.rows.slice(0, 500),
        nextOffset: complete ? null : (a.offset ?? 0) + 500,
        complete,
      };
      return {
        ...result(data, [
          evidence(
            a.organizationId,
            "profile",
            data,
            complete,
            new Date(organization.updated_at).toISOString(),
          ),
        ]),
        status: complete ? "ok" : "partial",
        code: complete ? null : "ASSISTANT_HISTORY_CONTINUES",
      };
    },
    list_documents: async (_c, a) => {
      await profile(a.organizationId);
      const docs = await documents().list({
        profileId: a.organizationId,
        limit: 100,
        offset: a.offset ?? 0,
      });
      return result(docs);
    },
    list_followups: async (_c, a) => {
      await profile(a.organizationId);
      const r = await pool.query(
        `SELECT * FROM follow_ups WHERE organization_id=$1 ORDER BY due_at,id`,
        [a.organizationId],
      );
      return result(r.rows, [evidence(a.organizationId, "profile", r.rows)]);
    },
    read_templates: async () => {
      const r = await pool.query(
        `SELECT id,code,name,template_version,subject_template,body_template,body_format,required_placeholders,reviewed_at FROM communication_templates WHERE state='active' AND reviewed_at IS NOT NULL ORDER BY name,id`,
      );
      return result(r.rows);
    },
    read_availability: async (_c, a) => {
      if (a.bookingId) {
        const check = await createProductionOutreachAllocation(
          db,
        ).evaluateCommitment(a.bookingId);
        const complete = check.capacity.status !== "needs_review";
        return {
          ...result(check, [
            evidence(a.bookingId, "calendar", check, complete),
          ]),
          status: complete ? "ok" : "partial",
          code: complete ? null : "ASSISTANT_RESOURCE_CHECK_REQUIRED",
        };
      }

      const rows = await pool.query(
        `SELECT id,name,organization_id,starts_at,ends_at,status FROM bookings WHERE starts_at<$2::timestamptz AND ends_at>$1::timestamptz AND status NOT IN ('cancelled','declined') ORDER BY starts_at`,
        [a.startsAt, a.endsAt],
      );
      return {
        status: "partial",
        data: {
          bookings: rows.rows,
          availabilityConfirmed: false,
          requires:
            "Check package allocations and shared foam/paintball resources before making an availability promise.",
        },
        evidence: [evidence("booking-calendar", "calendar", rows.rows, false)],
        receipts: [],
        code: "ASSISTANT_RESOURCE_CHECK_REQUIRED",
      };
    },
  };
  return { gmail, adapters, reader, documents, profile };
}
