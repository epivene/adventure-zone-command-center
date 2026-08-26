import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

import { APPROVED_LEAD_INTRODUCTION_2026 } from "../communication-templates/lead-introduction-2026-approved";
import {
  LeadEmailPreviewRepository,
  LeadEmailPreviewRepositoryError,
} from "./lead-email-preview-repository";
import { buildLeadEmailPreview, LeadEmailPreviewService } from "./lead-email-preview-service";

describe("LeadEmailPreviewRepository transactional contract", () => {
  it("uses one transaction and never reads dependent state from the root database", async () => {
    const expected = { lead: { rowId: "row" }, availability: null, blocks: [], approvedTemplate: null };
    const tx = { marker: "transaction", execute: vi.fn().mockResolvedValue([]) };
    const load = vi.fn().mockResolvedValue(expected);
    const database = {
      select: () => { throw new Error("root read escaped transaction"); },
      transaction: vi.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    };
    const repository = new LeadEmailPreviewRepository(database as never, { loadFromTransaction: load });

    await expect(repository.load("30000000-0000-4000-8000-000000000001", 7)).resolves.toBe(expected);
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(tx, "30000000-0000-4000-8000-000000000001", 7);
  });

  it("keeps the final preview consumer inside the serialized transaction boundary", async () => {
    const expected = { lead: { rowId: "row" }, availability: null, blocks: [], approvedTemplate: null };
    const events: string[] = [];
    let transactionActive = false;
    const tx = { execute: vi.fn(async () => { events.push("lock"); }) };
    const database = {
      transaction: vi.fn(async (callback: (value: unknown) => Promise<unknown>) => {
        transactionActive = true;
        const result = await callback(tx);
        events.push("commit");
        transactionActive = false;
        return result;
      }),
    };
    const repository = new LeadEmailPreviewRepository(database as never, {
      loadFromTransaction: async () => expected as never,
    });
    const withSerializedState = (repository as LeadEmailPreviewRepository & {
      withSerializedState?: <T>(rowId: string, version: number, consume: (state: any) => T) => Promise<T>;
    }).withSerializedState;

    expect(withSerializedState).toBeTypeOf("function");
    await expect(withSerializedState!.call(repository, "30000000-0000-4000-8000-000000000001", 7, (state) => {
      expect(transactionActive).toBe(true);
      expect(state).toBe(expected);
      events.push("render");
      return "preview";
    })).resolves.toBe("preview");
    expect(events).toEqual(["lock", "render", "commit"]);
  });

  it("returns a structured version conflict with expected and current versions", async () => {
    const repository = new LeadEmailPreviewRepository({ transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({ execute: vi.fn() }) } as never, {
      loadFromTransaction: async () => { throw new LeadEmailPreviewRepositoryError("VERSION_CONFLICT", "Reload before previewing.", { expectedVersion: 4, currentVersion: 5 }); },
    });
    await expect(repository.load("30000000-0000-4000-8000-000000000001", 4)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { expectedVersion: 4, currentVersion: 5 },
    });
  });

  it("performs repeated previews through the serialized repository consumer", async () => {
    const serialized: string[] = [];
    const state = {
      lead: {
        rowId: "30000000-0000-4000-8000-000000000001",
        reviewVersion: 1,
        profileName: "Aspen Filmfest",
        eventName: "Aspen Filmfest",
        eventCity: "Aspen",
        eventRegion: "CO",
        startDate: "2026-09-29",
        endDate: "2026-10-04",
        firstName: "Avery",
        recipientEmail: "person@example.com",
        rowState: "verified",
        recipientConfirmed: true,
        introductionSuitable: true,
        relationshipOutcome: "new_introduction",
        territoryStatus: "open",
        fitStatus: "approved",
      },
      availability: null,
      calendarEvidence: [],
      calendarReservations: [],
      blocks: [],
      approvedTemplate: null,
    };
    const service = new LeadEmailPreviewService({
      load: async () => { throw new Error("preview escaped serialization"); },
      withSerializedState: async (_rowId: string, _version: number, consume: (value: typeof state) => unknown) => {
        serialized.push("serialized");
        return consume(state);
      },
    } as never);
    await expect(service.preview("30000000-0000-4000-8000-000000000001", 1)).resolves.toMatchObject({ subject: null, body: null });
    await expect(service.preview("30000000-0000-4000-8000-000000000001", 1)).resolves.toMatchObject({ subject: null, body: null });
    expect(serialized).toEqual(["serialized", "serialized"]);
  });

  it("rejects private, unreviewed, wrong-version, and wrong-source template records", () => {
    const exact = {
      code: APPROVED_LEAD_INTRODUCTION_2026.code,
      templateVersion: APPROVED_LEAD_INTRODUCTION_2026.version,
      name: APPROVED_LEAD_INTRODUCTION_2026.name,
      state: "active",
      ownerKind: "company",
      createdByKind: "system",
      accessScope: "office",
      channel: "email",
      category: "lead_introduction",
      subjectTemplate: APPROVED_LEAD_INTRODUCTION_2026.subject,
      bodyTemplate: APPROVED_LEAD_INTRODUCTION_2026.bodyTemplate,
      allowedPlaceholders: [...APPROVED_LEAD_INTRODUCTION_2026.allowedPlaceholders],
      requiredPlaceholders: [...APPROVED_LEAD_INTRODUCTION_2026.requiredPlaceholders],
      sourceNote: APPROVED_LEAD_INTRODUCTION_2026.sourceNote,
      sourceFilename: APPROVED_LEAD_INTRODUCTION_2026.sourceFilename,
      sourceDisplayTitle: "Adventure Zone Sticky Notes",
      sourceCategory: "scripts_templates",
      sourceEffectiveYear: 2026,
      sourceAccessScope: "owner",
      sourceReviewState: "reviewed",
      sourceNotes: "Mixed historical and current scripts, package facts, internal notes, discounts, contacts, and ACT workflow. Reviewed selectively; never publish verbatim.",
      sourceStorageReference: "amy-library/ADVENTURE ZONE STICKY NOTES.docx.pdf",
      sourceReviewedBy: "system:business-drive-review",
      sourceReviewedAt: new Date("2026-08-25T00:00:00Z"),
      sourceDocumentId: "40000000-0000-4000-8000-000000000001",
      reviewedBy: APPROVED_LEAD_INTRODUCTION_2026.reviewedBy,
      reviewedAt: new Date("2026-08-26T00:00:00Z"),
    };

    expect(LeadEmailPreviewRepository.isExactApprovedTemplate(exact)).toBe(true);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, ownerKind: "office_user" })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, reviewedAt: null })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, templateVersion: "2026-prepaid-v0" })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, sourceFilename: "private-copy.pdf" })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, sourceReviewState: "unreviewed" })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, sourceReviewedBy: "owner:unknown" })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, sourceStorageReference: "unknown/wrong-content.pdf" })).toBe(false);
    expect(LeadEmailPreviewRepository.isExactApprovedTemplate({ ...exact, sourceReviewedAt: null })).toBe(false);
  });

  it("loads the locked row and all dependent state consistently, then withholds copy for an obsolete snapshot", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        create table organizations (id uuid primary key, name text not null, city text, region text, phone text, website text, consolidated_into_id uuid);
        create table contacts (id uuid primary key, first_name text not null, last_name text not null, email text, job_title text);
        create table lead_import_rows (
          id uuid primary key, review_version integer not null, state text not null,
          selected_organization_id uuid, selected_contact_id uuid, contact_mode text,
          confirmed_event_name text, confirmed_start_date date, confirmed_end_date date,
          confirmed_contact_name text, confirmed_contact_role text, confirmed_recipient_email text,
          recipient_confirmed boolean not null, introduction_suitable boolean not null,
          confirmed_by text, confirmed_at timestamptz, relationship_outcome text,
          relationship_anchor_at timestamptz, relationship_cutoff_date date,
          relationship_evidence_ids jsonb not null default '[]', latest_outbound_at timestamptz,
          latest_verified_response_at timestamptz, relationship_review_required boolean not null default false,
          relationship_classified_at timestamptz, relationship_classified_by text,
          territory_status text not null, fit_status text not null, updated_at timestamptz not null default now()
        );
        create table lead_availability_snapshots (
          id uuid primary key default gen_random_uuid(), row_id uuid not null, review_version integer not null,
          proposed_start_date date not null, proposed_end_date date not null, ready boolean not null,
          checked_by text not null, checked_at timestamptz not null, selected_calendar_ids jsonb not null,
          source_events jsonb not null, reservations jsonb not null, package_availability jsonb not null
        );
        create table communication_blocks (
          id uuid primary key default gen_random_uuid(), target_type text not null, organization_id uuid,
          contact_id uuid, normalized_email text, row_id uuid, reason text not null, active boolean not null default true,
          created_by text not null, created_at timestamptz not null default now(), removed_by text,
          removed_at timestamptz, removal_reason text
        );
        create table business_source_documents (
          id uuid primary key default gen_random_uuid(), original_filename text not null, display_title text not null,
          source_category text not null, effective_year integer, access_scope text not null, review_state text not null,
          storage_reference text, notes text, reviewed_by text, reviewed_at timestamptz,
          created_at timestamptz not null default now(), updated_at timestamptz not null default now()
        );
        create table communication_templates (
          id uuid primary key default gen_random_uuid(), code text not null, template_version text, name text not null,
          channel text not null, category text not null, subject_template text, body_template text not null,
          allowed_placeholders text[] not null, required_placeholders text[] not null, access_scope text not null,
          state text not null, owner_kind text not null, owner_office_account_id uuid, created_by_kind text not null,
          created_by_id uuid, source_template_id uuid, source_document_id uuid, source_note text,
          reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        insert into organizations (id, name, city, region) values ('10000000-0000-4000-8000-000000000001', 'Aspen Filmfest', 'Aspen', 'CO');
        insert into contacts (id, first_name, last_name, email) values ('20000000-0000-4000-8000-000000000001', 'Changed', 'Later', 'person@example.com');
        insert into lead_import_rows (
          id, review_version, state, selected_organization_id, selected_contact_id, contact_mode,
          confirmed_event_name, confirmed_start_date, confirmed_end_date, confirmed_contact_name,
          confirmed_recipient_email, recipient_confirmed,
          introduction_suitable, relationship_outcome, territory_status, fit_status
        ) values (
          '30000000-0000-4000-8000-000000000001', 4, 'verified',
          '10000000-0000-4000-8000-000000000001', null, 'manual',
          'Aspen Filmfest', '2026-09-29', '2026-10-04', 'Avery Jones', 'person@example.com', true, true,
          'new_introduction', 'open', 'approved'
        );
        insert into lead_availability_snapshots (
          row_id, review_version, proposed_start_date, proposed_end_date, ready, checked_by, checked_at,
          selected_calendar_ids, source_events, reservations, package_availability
        ) values (
          '30000000-0000-4000-8000-000000000001', 3, '2026-09-20', '2026-09-21', true, 'owner', now(),
          '[]', '[{"calendarId":"primary","eventId":"event-1"}]', '[]',
          '{"packages":[{"packageKey":"adventure_zone","availableQuantity":1}]}'
        );
      `);
      const db = drizzle(client, { schema });
      const [source] = await db.insert(schema.businessSourceDocuments).values({
        originalFilename: APPROVED_LEAD_INTRODUCTION_2026.sourceFilename,
        displayTitle: "Adventure Zone Sticky Notes",
        sourceCategory: "scripts_templates",
        effectiveYear: 2026,
        accessScope: "owner",
        reviewState: "reviewed",
        storageReference: APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.storageReference,
        notes: "Mixed historical and current scripts, package facts, internal notes, discounts, contacts, and ACT workflow. Reviewed selectively; never publish verbatim.",
        reviewedBy: "system:business-drive-review",
        reviewedAt: new Date("2026-08-25T00:00:00Z"),
      }).returning();
      await db.insert(schema.communicationTemplates).values({
        code: APPROVED_LEAD_INTRODUCTION_2026.code,
        templateVersion: APPROVED_LEAD_INTRODUCTION_2026.version,
        name: APPROVED_LEAD_INTRODUCTION_2026.name,
        channel: "email",
        category: "lead_introduction",
        subjectTemplate: APPROVED_LEAD_INTRODUCTION_2026.subject,
        bodyTemplate: APPROVED_LEAD_INTRODUCTION_2026.bodyTemplate,
        allowedPlaceholders: [...APPROVED_LEAD_INTRODUCTION_2026.allowedPlaceholders],
        requiredPlaceholders: [...APPROVED_LEAD_INTRODUCTION_2026.requiredPlaceholders],
        accessScope: "office", state: "active", ownerKind: "company", createdByKind: "system",
        sourceDocumentId: source!.id, sourceNote: APPROVED_LEAD_INTRODUCTION_2026.sourceNote,
        reviewedBy: APPROVED_LEAD_INTRODUCTION_2026.reviewedBy, reviewedAt: new Date("2026-08-26T00:00:00Z"),
      });
      const repository = new LeadEmailPreviewRepository(db as never);

      const state = await repository.load("30000000-0000-4000-8000-000000000001", 4);
      expect(state.approvedTemplate).toMatchObject({ version: "2026-prepaid-v1", sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf" });
      expect(state.lead.firstName).toBe("Avery");
      expect(buildLeadEmailPreview(state)).toMatchObject({
        rowVersion: 4,
        snapshotVersion: 3,
        readiness: { ready: false, blockers: expect.arrayContaining(["availability_stale_for_lead_version"]) },
        subject: null,
        body: null,
      });
      const templateBefore = (await client.query(`
        select reviewed_by, reviewed_at, updated_at
        from communication_templates
        where code = '${APPROVED_LEAD_INTRODUCTION_2026.code}'
      `)).rows[0];
      const service = new LeadEmailPreviewService(repository);
      await service.preview("30000000-0000-4000-8000-000000000001", 4);
      await service.preview("30000000-0000-4000-8000-000000000001", 4);
      expect((await client.query(`
        select reviewed_by, reviewed_at, updated_at
        from communication_templates
        where code = '${APPROVED_LEAD_INTRODUCTION_2026.code}'
      `)).rows[0]).toEqual(templateBefore);
      await client.exec(`
        update lead_import_rows
        set contact_mode = 'organization_inbox', confirmed_contact_name = 'Mutable Inbox Label'
        where id = '30000000-0000-4000-8000-000000000001'
      `);
      expect((await repository.load("30000000-0000-4000-8000-000000000001", 4)).lead.firstName).toBeNull();
      await expect(repository.load("30000000-0000-4000-8000-000000000001", 3)).rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        details: { expectedVersion: 3, currentVersion: 4 },
      });
    } finally {
      await client.close();
    }
  }, 20_000);
});
