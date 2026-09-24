import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Queryable,
  ToolRegistry,
  RunContext,
  ActionIntent,
} from "./contracts";
import type { DocumentReader } from "./document-reader";
import type { ActionExecutor } from "./action-executor";
import type { RunStore } from "./run-store";
import {
  commercialActionSchemas,
  parseCommercialAction,
} from "./commercial-actions";
import { readCommercialRecords } from "./commercial-evidence";
import { compareDocuments, type ComparisonSource } from "./document-comparison";
import { blocked, result } from "./read-tools";
import { recordRevision } from "./commercial-adapters";
const uuid = z.string().uuid();
const reads = {
  read_commercial_records: z
    .object({
      organizationId: uuid,
      eventYear: z.number().int().min(2000).max(2200),
    })
    .strict(),
  compare_documents: z
    .object({
      sources: z
        .array(
          z
            .object({
              documentId: uuid,
              expectedVersion: z.string().nullable(),
            })
            .strict(),
        )
        .min(2)
        .max(4),
    })
    .strict(),
  read_document_templates: z.object({}).strict(),
  read_contract_draft: z.object({ draftId: uuid }).strict(),
};
const schemas = {
  ...reads,
  ...Object.fromEntries(
    Object.entries(commercialActionSchemas).map(([name, values]) => [
      name,
      z
        .object({ targetId: uuid, expectedRevision: z.string().min(1), values })
        .strict(),
    ]),
  ),
};
export function createCommercialTools(deps: {
  ownerId: string;
  db: Queryable;
  reader: DocumentReader;
  executor: ActionExecutor;
  runs: RunStore;
}): ToolRegistry {
  const metadata = async (id: string): Promise<ComparisonSource> => {
    const row = (
      await deps.db.query(
        `SELECT d.id,d.display_name AS title,d.category,coalesce((SELECT jsonb_agg(DISTINCT coalesce(l.organization_id,b.organization_id)) FROM business_document_links l LEFT JOIN bookings b ON b.id=l.booking_id WHERE l.document_id=d.id),'[]'::jsonb) AS organizations,(SELECT CASE WHEN count(DISTINCT o.event_year)=1 THEN min(o.event_year) ELSE NULL END FROM business_document_links l JOIN booking_opportunities o ON o.booking_id=l.booking_id WHERE l.document_id=d.id) AS event_year FROM business_documents d WHERE d.id=$1 AND d.lifecycle<>'deleted'`,
        [id],
      )
    ).rows[0];
    if (!row) throw new Error("ASSISTANT_DOCUMENT_UNAVAILABLE");
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      organizationIds: row.organizations.filter(Boolean),
      eventYear: row.event_year,
    };
  };
  return {
    definitions(c) {
      if (c.actor.id !== deps.ownerId || c.actor.role !== "owner") return [];
      return Object.entries(schemas).map(([name, schema]) => ({
        type: "function",
        name,
        description:
          name === "compare_documents"
            ? "Read complete document sources for factual comparison. Keep customer/year terms separate and report unreadable pages; never infer signing, payment or coverage."
            : `Perform ${name.replaceAll("_", " ")}. Mutation proposals require exact current record revision and explicit owner action review. Payment and signature confirmations require an additional human verification.`,
        parameters: z.toJSONSchema(schema, { io: "input" }),
        strict: false,
      }));
    },
    async execute(c, call) {
      if (
        c.actor.id !== deps.ownerId ||
        c.actor.role !== "owner" ||
        c.signal.aborted
      )
        return blocked("ASSISTANT_ACCESS_DENIED");
      const schema = schemas[call.name as keyof typeof schemas];
      if (!schema) return blocked("ASSISTANT_TOOL_UNKNOWN");
      let args: any;
      try {
        args = schema.parse(JSON.parse(call.arguments));
      } catch {
        return blocked("ASSISTANT_ARGUMENTS_INVALID");
      }
      try {
        if (call.name === "read_commercial_records")
          return await readCommercialRecords(deps.db, c, args);
        if (call.name === "compare_documents")
          return await compareDocuments(c, args.sources, deps.reader, metadata);
        if (call.name === "read_document_templates") {
          const templates = (
            await deps.db.query(
              "SELECT id,name,type,catalog_revision,state,is_approved,updated_at,description FROM design_templates WHERE state='active' AND is_approved=true AND type IN ('proposal','contract','blank','brochure') ORDER BY name,id LIMIT 100",
            )
          ).rows.map((row) => ({ ...row, revision: recordRevision(row) }));
          return result({
            templates,
            limitation:
              "Only approved active templates are available. A missing invoice layout requires review in Design Studio; do not invent a template.",
          });
        }
        if (call.name === "read_contract_draft")
          return await readCurrentContractDraft(deps.db, c, args.draftId);
        const run = await deps.runs.get(c.actor.id, c.runId);
        if (!run || run.conversationId !== c.conversationId)
          return blocked("ASSISTANT_RUN_NOT_FOUND");
        const intent: ActionIntent = {
          id: randomUUID(),
          actorId: c.actor.id,
          conversationId: c.conversationId,
          kind: call.name,
          targetId: args.targetId,
          expectedRevision: args.expectedRevision,
          connectionId: null,
          arguments: parseCommercialAction(call.name, args.values),
          sourceMessageId: run.input.sourceMessageId,
        };
        return await deps.executor.execute(c, intent);
      } catch (error) {
        return blocked(
          error instanceof Error && error.message.startsWith("ASSISTANT_")
            ? error.message
            : "ASSISTANT_DOCUMENT_WORKFLOW_UNAVAILABLE",
        );
      }
    },
  };
}

export async function readCurrentContractDraft(
  db: Queryable,
  c: RunContext,
  draftId: string,
) {
  const row = (
    await db.query(
      `SELECT d.*,(SELECT CASE WHEN count(DISTINCT event_year)=1 THEN min(event_year) ELSE NULL END FROM booking_opportunities o WHERE o.booking_id=d.booking_id AND o.organization_id=d.organization_id) AS canonical_year FROM contract_drafts d JOIN bookings b ON b.id=d.booking_id AND b.organization_id=d.organization_id WHERE d.id=$1`,
      [draftId],
    )
  ).rows[0];
  if (!row || !c.selection.organizationIds.includes(row.organization_id))
    return blocked("ASSISTANT_CONTRACT_NOT_FOUND");
  if (c.selection.bookingId && c.selection.bookingId !== row.booking_id)
    return blocked("ASSISTANT_BOOKING_MISMATCH");
  if (!c.selection.eventYear || row.canonical_year !== c.selection.eventYear)
    return blocked("ASSISTANT_EVENT_YEAR_MISMATCH");
  const values = row.values?.contract;
  if (
    values &&
    (values.organizationId !== row.organization_id ||
      values.bookingId !== row.booking_id ||
      (values.eventStartDate &&
        Number(String(values.eventStartDate).slice(0, 4)) !==
          row.canonical_year))
  )
    return blocked("ASSISTANT_CONTRACT_CONTEXT_MISMATCH");
  return result({
    ...row,
    eventYear: row.canonical_year,
    revision: String(row.revision),
    href: `/contracts/drafts/${row.id}`,
  });
}
