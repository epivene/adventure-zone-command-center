import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { composePaperNoteHistory } from "./paper-note-note-composer";
import {
  PaperNotePhoneService,
  type PaperNoteTransaction,
  type StructuredPhoneMutation,
} from "./paper-note-phone-service";
import type { PaperNotePreflightService } from "./paper-note-preflight-service";
import type { PaperNoteImportSummary } from "./paper-note-types";
import type {
  PaperNoteConflictDecision,
  PaperNoteReviewPayload,
  PaperNoteReviewedPhone,
} from "./paper-note-review-schema";

type DrizzleDatabase = typeof database;

type StoredBatch = {
  status: string;
  importRequestKey: string | null;
  importSummary: PaperNoteImportSummary | null;
};

type StoredEntry = {
  id: string;
  state: string;
  reviewPayload: PaperNoteReviewPayload;
  extractionPayload: { transcription?: string };
};

export class PaperNoteImportError extends Error {
  constructor(
    public readonly code:
      | "BATCH_NOT_FOUND"
      | "BATCH_NOT_READY"
      | "IMPORT_IN_PROGRESS"
      | "ENTRY_INVALID"
      | "CONTACT_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "PaperNoteImportError";
  }
}

function emptySummary(): PaperNoteImportSummary {
  return {
    profilesCreated: 0,
    profilesUpdated: 0,
    locationsCreated: 0,
    contactsCreated: 0,
    contactsLinked: 0,
    phonesCreatedOrUpdated: 0,
    historicalNotesCreated: 0,
    followUpsCreated: 0,
    entriesSkipped: 0,
  };
}

function dateAtNoonUtc(value: string | null) {
  if (!value) return null;
  return new Date(`${value}T12:00:00.000Z`);
}

function splitContactName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() ?? "Unknown",
    lastName: parts.join(" "),
  };
}

function phoneConflict(
  conflicts: Record<string, PaperNoteConflictDecision>,
  path: string,
) {
  const decision = conflicts[path];
  return decision?.kind === "phone" ? decision : null;
}

async function resultRows<T>(promise: Promise<unknown>): Promise<T[]> {
  const result = await promise as { rows?: T[] };
  return result.rows ?? [];
}

export class PaperNoteImportService {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly preflightService: Pick<PaperNotePreflightService, "preflight">,
    private readonly phoneService: PaperNotePhoneService,
  ) {}

  async importBatch(input: {
    actorId: string;
    batchId: string;
    requestKey: string;
    now: Date;
  }): Promise<PaperNoteImportSummary> {
    const existing = await this.readBatch(input.actorId, input.batchId);
    if (!existing) {
      throw new PaperNoteImportError("BATCH_NOT_FOUND", "Paper-note batch was not found.");
    }
    if ((existing.status === "imported" || existing.status === "archived") && existing.importSummary) {
      return existing.importSummary;
    }

    const preflight = await this.preflightService.preflight({
      actorId: input.actorId,
      batchId: input.batchId,
      now: input.now,
    });
    if (!preflight.ready) {
      throw new PaperNoteImportError(
        "BATCH_NOT_READY",
        preflight.blocking[0]?.message ?? "Review the paper-note batch before importing it.",
      );
    }

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as DrizzleDatabase;
      const [batch] = await resultRows<StoredBatch>(tx.execute(sql`
        select
          status,
          import_request_key as "importRequestKey",
          import_summary as "importSummary"
        from paper_note_batches
        where id = ${input.batchId}::uuid
          and created_by = ${input.actorId}
        for update
      `));
      if (!batch) {
        throw new PaperNoteImportError("BATCH_NOT_FOUND", "Paper-note batch was not found.");
      }
      if ((batch.status === "imported" || batch.status === "archived") && batch.importSummary) {
        return batch.importSummary;
      }
      if (batch.status === "importing" && batch.importRequestKey && batch.importRequestKey !== input.requestKey) {
        throw new PaperNoteImportError(
          "IMPORT_IN_PROGRESS",
          "This paper-note batch is already being imported.",
        );
      }
      if (batch.status !== "review" && batch.status !== "importing") {
        throw new PaperNoteImportError(
          "BATCH_NOT_READY",
          "This paper-note batch is not ready to import.",
        );
      }

      await tx.execute(sql`
        update paper_note_batches
        set
          status = 'importing',
          import_request_key = coalesce(import_request_key, ${input.requestKey}::uuid),
          import_started_at = coalesce(import_started_at, ${input.now}),
          updated_at = ${input.now}
        where id = ${input.batchId}::uuid
      `);

      const entries = await resultRows<StoredEntry>(tx.execute(sql`
        select
          id,
          state,
          review_payload as "reviewPayload",
          extraction_payload as "extractionPayload"
        from paper_note_entries
        where batch_id = ${input.batchId}::uuid
        order by page_id asc, source_order asc
        for update
      `));
      if (!entries.length || entries.some((entry) => entry.state !== "approved" && entry.state !== "skipped")) {
        throw new PaperNoteImportError(
          "ENTRY_INVALID",
          "Every paper entry must be Approved or Skipped before import.",
        );
      }

      const summary = emptySummary();
      for (const entry of entries) {
        if (entry.state === "skipped") {
          summary.entriesSkipped += 1;
          await tx.execute(sql`
            update paper_note_entries
            set import_result = ${JSON.stringify({ action: "skipped" })}::jsonb,
                updated_at = ${input.now}
            where id = ${entry.id}::uuid
          `);
          continue;
        }
        await this.importEntry(
          tx,
          entry,
          input.now,
          summary,
        );
      }

      await tx.execute(sql`
        update paper_note_batches
        set
          status = 'imported',
          import_summary = ${JSON.stringify(summary)}::jsonb,
          imported_at = ${input.now},
          updated_at = ${input.now}
        where id = ${input.batchId}::uuid
      `);
      return summary;
    });
  }

  private async readBatch(actorId: string, batchId: string) {
    const [row] = await resultRows<StoredBatch>(this.database.execute(sql`
      select
        status,
        import_request_key as "importRequestKey",
        import_summary as "importSummary"
      from paper_note_batches
      where id = ${batchId}::uuid
        and created_by = ${actorId}
      limit 1
    `));
    return row ?? null;
  }

  private async importEntry(
    tx: DrizzleDatabase,
    entry: StoredEntry,
    now: Date,
    summary: PaperNoteImportSummary,
  ) {
    const review = entry.reviewPayload;
    const destination = review.destination;
    if (!destination || destination.mode === "skip") {
      throw new PaperNoteImportError("ENTRY_INVALID", "Approved paper entry has no CRM destination.");
    }

    let organizationId: string;
    let organizationLocationId: string | null = null;
    const isNewProfile = destination.mode === "new_profile";

    if (destination.mode === "new_profile") {
      const [organization] = await resultRows<{ id: string }>(tx.execute(sql`
        insert into organizations (
          name, place_type, city, region, created_at, updated_at
        ) values (
          ${review.event.name.trim()},
          'festival_event',
          ${review.event.city.trim() || null},
          ${review.event.region.trim().toUpperCase() || null},
          ${now},
          ${now}
        ) returning id
      `));
      if (!organization) throw new Error("Paper-note profile could not be created.");
      organizationId = organization.id;
      summary.profilesCreated += 1;
      if (destination.eventFamilyId) {
        await tx.execute(sql`
          insert into event_family_members (family_id, organization_id, source, created_at)
          select ${destination.eventFamilyId}::uuid, ${organizationId}::uuid, 'manual', ${now}
          where exists (select 1 from event_families where id = ${destination.eventFamilyId}::uuid)
          on conflict do nothing
        `);
      }
    } else {
      organizationId = destination.organizationId;
      summary.profilesUpdated += 1;
      if (destination.mode === "existing_profile") {
        organizationLocationId = destination.organizationLocationId;
      } else {
        const location = destination.newLocation;
        const [createdLocation] = await resultRows<{ id: string }>(tx.execute(sql`
          insert into organization_locations (
            organization_id, label, venue_name, address_1, address_2,
            city, region, postal_code, created_at, updated_at
          ) values (
            ${organizationId}::uuid,
            ${location.label.trim()},
            ${location.venueName},
            ${location.address1},
            ${location.address2},
            ${location.city},
            ${location.region},
            ${location.postalCode},
            ${now},
            ${now}
          ) returning id
        `));
        if (!createdLocation) throw new Error("Paper-note location could not be created.");
        organizationLocationId = createdLocation.id;
        summary.locationsCreated += 1;
      }
    }

    const contactIdsByKey = new Map<string, string>();
    let activityContactId: string | null = null;
    for (let contactIndex = 0; contactIndex < review.contacts.length; contactIndex += 1) {
      const contact = review.contacts[contactIndex]!;
      if (contact.mode === "note_only") continue;
      let contactId: string;
      const contactIsNew = contact.mode === "new_contact";
      if (contact.mode === "existing_contact") {
        if (!contact.selectedContactId) {
          throw new PaperNoteImportError("CONTACT_NOT_FOUND", "Choose the existing contact to link.");
        }
        const [existingContact] = await resultRows<{ id: string }>(tx.execute(sql`
          select id from contacts where id = ${contact.selectedContactId}::uuid limit 1
        `));
        if (!existingContact) {
          throw new PaperNoteImportError("CONTACT_NOT_FOUND", "The selected contact is no longer available.");
        }
        contactId = existingContact.id;
        await tx.execute(sql`
          insert into organization_contacts (
            organization_id, contact_id, role, is_primary, active, source, created_at, updated_at
          ) values (
            ${organizationId}::uuid,
            ${contactId}::uuid,
            ${contact.role},
            false,
            true,
            'local',
            ${now},
            ${now}
          ) on conflict (organization_id, contact_id) do nothing
        `);
        summary.contactsLinked += 1;
        await this.applyExplicitContactConflicts(tx, contactId, contactIndex, review, now);
      } else {
        const name = splitContactName(contact.name);
        const [createdContact] = await resultRows<{ id: string }>(tx.execute(sql`
          insert into contacts (
            organization_id, first_name, last_name, email, job_title,
            organization_location_id, created_at, updated_at
          ) values (
            null,
            ${name.firstName},
            ${name.lastName},
            ${contact.email},
            ${contact.role},
            ${organizationLocationId}::uuid,
            ${now},
            ${now}
          ) returning id
        `));
        if (!createdContact) throw new Error("Paper-note contact could not be created.");
        contactId = createdContact.id;
        const useAsPrimaryPerson = isNewProfile && contact.primary;
        if (useAsPrimaryPerson) {
          await tx.execute(sql`
            update organization_contacts
            set is_primary = false, updated_at = ${now}
            where organization_id = ${organizationId}::uuid
              and active = true
              and is_primary = true
          `);
        }
        await tx.execute(sql`
          insert into organization_contacts (
            organization_id, contact_id, role, is_primary, active, source, created_at, updated_at
          ) values (
            ${organizationId}::uuid,
            ${contactId}::uuid,
            ${contact.role},
            ${useAsPrimaryPerson},
            true,
            'local',
            ${now},
            ${now}
          )
        `);
        await tx.execute(sql`
          update contacts
          set organization_id = ${organizationId}::uuid,
              organization_location_id = ${organizationLocationId}::uuid,
              updated_at = ${now}
          where id = ${contactId}::uuid
        `);
        summary.contactsCreated += 1;
      }

      contactIdsByKey.set(contact.key, contactId);
      if (!activityContactId || contact.primary) activityContactId = contactId;

      for (let phoneIndex = 0; phoneIndex < contact.phones.length; phoneIndex += 1) {
        const phone = contact.phones[phoneIndex]!;
        if (!phone.importAsStructuredValue) continue;
        const path = `contacts.${contactIndex}.phones.${phoneIndex}`;
        const existingPhoneId = await this.findExactContactPhone(tx, contactId, phone);
        const decision = this.phoneDecision(
          review,
          path,
          phone,
          existingPhoneId,
          contactIsNew,
        );
        const result = await this.phoneService.apply(tx as unknown as PaperNoteTransaction, {
          owner: { kind: "contact", contactId },
          decision: decision.decision,
          paper: phone,
          existingPhoneId: decision.existingPhoneId,
          sourcePaperNoteEntryId: entry.id,
        }, now);
        if (result.phoneId) summary.phonesCreatedOrUpdated += 1;
      }
    }

    for (let phoneIndex = 0; phoneIndex < review.organizationPhones.length; phoneIndex += 1) {
      const phone = review.organizationPhones[phoneIndex]!;
      if (!phone.importAsStructuredValue) continue;
      const path = `organizationPhones.${phoneIndex}`;
      const existingPhoneId = await this.findExactOrganizationPhone(
        tx,
        organizationId,
        organizationLocationId,
        phone,
      );
      const decision = this.phoneDecision(review, path, phone, existingPhoneId, isNewProfile);
      const result = await this.phoneService.apply(tx as unknown as PaperNoteTransaction, {
        owner: {
          kind: "organization",
          organizationId,
          organizationLocationId,
        },
        decision: decision.decision,
        paper: phone,
        existingPhoneId: decision.existingPhoneId,
        sourcePaperNoteEntryId: entry.id,
      }, now);
      if (result.phoneId) summary.phonesCreatedOrUpdated += 1;
    }

    const historyBody = composePaperNoteHistory({
      review,
      originalTranscription: entry.extractionPayload.transcription ?? "",
    });
    const occurredAt = dateAtNoonUtc(review.activity.occurredOn);
    const [activity] = await resultRows<{ id: string }>(tx.execute(sql`
      insert into activities (
        organization_id, contact_id, booking_id, kind, subject, body,
        occurred_at, timeline_sort_at, date_is_import_fallback, source_type,
        organization_location_id, paper_note_entry_id, created_at, updated_at
      ) values (
        ${organizationId}::uuid,
        ${activityContactId}::uuid,
        null,
        'note',
        'Imported from paper notes',
        ${historyBody},
        ${occurredAt},
        ${occurredAt ?? now},
        ${occurredAt === null},
        'paper_note',
        ${organizationLocationId}::uuid,
        ${entry.id}::uuid,
        ${now},
        ${now}
      ) returning id
    `));
    if (!activity) throw new Error("Paper-note history could not be created.");
    summary.historicalNotesCreated += 1;

    let followUpId: string | null = null;
    if (review.currentFollowUp.enabled && review.currentFollowUp.dueOn) {
      const selectedFollowUpContact = review.currentFollowUp.contactKey
        ? contactIdsByKey.get(review.currentFollowUp.contactKey) ?? null
        : activityContactId;
      const [followUp] = await resultRows<{ id: string }>(tx.execute(sql`
        insert into follow_ups (
          organization_id, contact_id, kind, due_at, organization_location_id,
          created_at, updated_at
        ) values (
          ${organizationId}::uuid,
          ${selectedFollowUpContact}::uuid,
          ${review.currentFollowUp.kind || "call"},
          ${dateAtNoonUtc(review.currentFollowUp.dueOn)},
          ${organizationLocationId}::uuid,
          ${now},
          ${now}
        ) returning id
      `));
      followUpId = followUp?.id ?? null;
      if (!followUpId) throw new Error("Current paper-note follow-up could not be created.");
      summary.followUpsCreated += 1;
    }

    await tx.execute(sql`
      insert into audit_entries (
        entity_type, entity_id, action, before, after, created_at
      ) values (
        'activity',
        ${activity.id}::uuid,
        'paper_note_import',
        null,
        ${JSON.stringify({ paperNoteEntryId: entry.id, organizationId, organizationLocationId, followUpId })}::jsonb,
        ${now}
      )
    `);

    const importResult = {
      organizationId,
      organizationLocationId,
      activityId: activity.id,
      followUpId,
    };
    await tx.execute(sql`
      update paper_note_entries
      set
        state = 'imported',
        imported_organization_id = ${organizationId}::uuid,
        imported_organization_location_id = ${organizationLocationId}::uuid,
        imported_activity_id = ${activity.id}::uuid,
        import_result = ${JSON.stringify(importResult)}::jsonb,
        updated_at = ${now}
      where id = ${entry.id}::uuid
    `);
  }

  private phoneDecision(
    review: PaperNoteReviewPayload,
    path: string,
    phone: PaperNoteReviewedPhone,
    exactExistingPhoneId: string | null,
    ownerIsNew: boolean,
  ): { decision: StructuredPhoneMutation["decision"]; existingPhoneId: string | null } {
    const explicit = phoneConflict(review.conflicts, path);
    if (explicit) {
      return {
        decision: explicit.decision,
        existingPhoneId: explicit.existingPhoneId,
      };
    }
    if (phone.crossedOut) {
      return { decision: "crossed_out_note_only", existingPhoneId: exactExistingPhoneId };
    }
    if (exactExistingPhoneId) {
      return { decision: "keep_saved", existingPhoneId: exactExistingPhoneId };
    }
    if (phone.status === "questionable") {
      return { decision: "add_questionable", existingPhoneId: null };
    }
    if (ownerIsNew && phone.primary) {
      return { decision: "replace_primary", existingPhoneId: null };
    }
    return { decision: "add_alternate", existingPhoneId: null };
  }

  private async findExactContactPhone(
    tx: DrizzleDatabase,
    contactId: string,
    phone: PaperNoteReviewedPhone,
  ) {
    const normalized = normalizeNorthAmericanPhone(phone.number);
    if (!normalized) return null;
    const extension = phone.extension?.trim() || null;
    const [row] = await resultRows<{ id: string }>(tx.execute(sql`
      select id
      from contact_phones
      where contact_id = ${contactId}::uuid
        and normalized_number = ${normalized}
        and coalesce(extension, '') = coalesce(${extension}, '')
      limit 1
    `));
    return row?.id ?? null;
  }

  private async findExactOrganizationPhone(
    tx: DrizzleDatabase,
    organizationId: string,
    organizationLocationId: string | null,
    phone: PaperNoteReviewedPhone,
  ) {
    const normalized = normalizeNorthAmericanPhone(phone.number);
    if (!normalized) return null;
    const extension = phone.extension?.trim() || null;
    const [row] = await resultRows<{ id: string }>(tx.execute(sql`
      select id
      from organization_phones
      where organization_id = ${organizationId}::uuid
        and organization_location_id is not distinct from ${organizationLocationId}::uuid
        and normalized_number = ${normalized}
        and coalesce(extension, '') = coalesce(${extension}, '')
      limit 1
    `));
    return row?.id ?? null;
  }

  private async applyExplicitContactConflicts(
    tx: DrizzleDatabase,
    contactId: string,
    contactIndex: number,
    review: PaperNoteReviewPayload,
    now: Date,
  ) {
    const contact = review.contacts[contactIndex]!;
    const emailDecision = review.conflicts[`contacts.${contactIndex}.email`];
    if (emailDecision?.kind === "field" && emailDecision.decision === "replace_saved") {
      await tx.execute(sql`
        update contacts set email = ${contact.email}, updated_at = ${now}
        where id = ${contactId}::uuid
      `);
    }
    const nameDecision = review.conflicts[`contacts.${contactIndex}.name`];
    if (nameDecision?.kind === "field" && nameDecision.decision === "replace_saved") {
      const name = splitContactName(contact.name);
      await tx.execute(sql`
        update contacts
        set first_name = ${name.firstName}, last_name = ${name.lastName}, updated_at = ${now}
        where id = ${contactId}::uuid
      `);
    }
  }
}
