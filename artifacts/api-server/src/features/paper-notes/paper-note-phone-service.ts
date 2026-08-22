import { sql } from "drizzle-orm";

import type { db } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import type { PaperNotePhoneDecision } from "./paper-note-review-schema";

export type PaperNoteTransaction = Pick<typeof db, "execute">;

export type StructuredPhoneMutation = {
  owner:
    | { kind: "contact"; contactId: string }
    | {
        kind: "organization";
        organizationId: string;
        organizationLocationId: string | null;
      };
  decision: PaperNotePhoneDecision;
  paper: {
    number: string;
    extension: string | null;
    type: "mobile" | "office" | "alternate" | "unknown";
    label: string | null;
    instructions: string | null;
    status: "active" | "questionable" | "inactive";
  };
  existingPhoneId: string | null;
  sourcePaperNoteEntryId: string;
};

export class PaperNotePhoneMutationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PHONE"
      | "PHONE_NOT_FOUND"
      | "LOCATION_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "PaperNotePhoneMutationError";
  }
}

function normalizedExtension(value: string | null) {
  const clean = value?.trim() ?? "";
  return clean || null;
}

async function rows<T>(promise: Promise<unknown>): Promise<T[]> {
  const result = await promise as { rows?: T[] };
  return result.rows ?? [];
}

export class PaperNotePhoneService {
  async apply(
    transaction: PaperNoteTransaction,
    mutation: StructuredPhoneMutation,
    now: Date,
  ): Promise<{ phoneId: string | null; action: string }> {
    if (
      mutation.decision === "keep_saved" ||
      mutation.decision === "ignore_paper" ||
      mutation.decision === "crossed_out_note_only"
    ) {
      return { phoneId: null, action: mutation.decision };
    }

    const normalized = normalizeNorthAmericanPhone(mutation.paper.number);
    if (!normalized) {
      throw new PaperNotePhoneMutationError(
        "INVALID_PHONE",
        "Check the paper phone number before importing it.",
      );
    }
    const extension = normalizedExtension(mutation.paper.extension);

    if (mutation.owner.kind === "organization" && mutation.owner.organizationLocationId) {
      const location = await rows<{ id: string }>(transaction.execute(sql`
        select id
        from organization_locations
        where id = ${mutation.owner.organizationLocationId}::uuid
          and organization_id = ${mutation.owner.organizationId}::uuid
        limit 1
      `));
      if (!location.length) {
        throw new PaperNotePhoneMutationError(
          "LOCATION_NOT_FOUND",
          "The selected organization location is no longer available.",
        );
      }
    }

    if (mutation.decision === "same_phone_update_details") {
      if (!mutation.existingPhoneId) {
        throw new PaperNotePhoneMutationError(
          "PHONE_NOT_FOUND",
          "Choose the saved phone that matches this paper number.",
        );
      }
      return mutation.owner.kind === "contact"
        ? this.updateContactPhone(transaction, mutation, normalized, extension, now)
        : this.updateOrganizationPhone(transaction, mutation, normalized, extension, now);
    }

    if (
      mutation.owner.kind === "contact" &&
      (mutation.decision === "add_alternate" || mutation.decision === "add_questionable")
    ) {
      const existing = await rows<{ id: string }>(transaction.execute(sql`
        select id
        from contact_phones
        where contact_id = ${mutation.owner.contactId}::uuid
          and normalized_number = ${normalized}
        limit 1
      `));
      if (existing[0]) {
        return { phoneId: existing[0].id, action: "already_present" };
      }
    }

    const shouldReplacePrimary = mutation.decision === "replace_primary";
    const shouldInactivateOld = mutation.decision === "inactivate_saved_add_paper";
    if (shouldInactivateOld) {
      if (!mutation.existingPhoneId) {
        throw new PaperNotePhoneMutationError(
          "PHONE_NOT_FOUND",
          "Choose the saved phone to mark inactive.",
        );
      }
      await this.inactivateExisting(transaction, mutation, now);
    }

    const primary = shouldReplacePrimary || shouldInactivateOld;
    const status = mutation.decision === "add_questionable"
      ? "questionable"
      : primary
        ? "active"
        : mutation.paper.status;

    if (primary) {
      await this.demotePrimary(transaction, mutation);
    }

    const phoneId = mutation.owner.kind === "contact"
      ? await this.insertContactPhone(
          transaction,
          mutation,
          normalized,
          extension,
          status,
          primary,
          now,
        )
      : await this.insertOrganizationPhone(
          transaction,
          mutation,
          normalized,
          extension,
          status,
          primary,
          now,
        );

    if (primary) {
      await this.syncLegacyPrimary(transaction, mutation, normalized, now);
    }

    return {
      phoneId,
      action: mutation.decision === "add_questionable"
        ? "added_questionable"
        : mutation.decision === "replace_primary"
          ? "replaced_primary"
          : mutation.decision === "inactivate_saved_add_paper"
            ? "inactivated_saved_and_added_paper"
            : "added_alternate",
    };
  }

  private async updateContactPhone(
    tx: PaperNoteTransaction,
    mutation: Extract<StructuredPhoneMutation, { owner: { kind: "contact" } }> | StructuredPhoneMutation,
    normalized: string,
    extension: string | null,
    now: Date,
  ) {
    if (mutation.owner.kind !== "contact") throw new Error("Contact phone owner expected.");
    const result = await rows<{ id: string; primary: boolean }>(tx.execute(sql`
      update contact_phones
      set
        number = ${mutation.paper.number.trim()},
        normalized_number = ${normalized},
        type = ${mutation.paper.type},
        extension = ${extension},
        label = ${mutation.paper.label},
        instructions = ${mutation.paper.instructions},
        status = ${mutation.paper.status},
        source = 'paper_note',
        source_paper_note_entry_id = ${mutation.sourcePaperNoteEntryId}::uuid,
        updated_at = ${now}
      where id = ${mutation.existingPhoneId}::uuid
        and contact_id = ${mutation.owner.contactId}::uuid
      returning id, primary
    `));
    const row = result[0];
    if (!row) throw new PaperNotePhoneMutationError("PHONE_NOT_FOUND", "Saved contact phone was not found.");
    if (row.primary && mutation.paper.status === "active") {
      await this.syncLegacyPrimary(tx, mutation, normalized, now);
    }
    return { phoneId: row.id, action: "updated_same_phone" };
  }

  private async updateOrganizationPhone(
    tx: PaperNoteTransaction,
    mutation: StructuredPhoneMutation,
    normalized: string,
    extension: string | null,
    now: Date,
  ) {
    if (mutation.owner.kind !== "organization") throw new Error("Organization phone owner expected.");
    const result = await rows<{ id: string; primary: boolean }>(tx.execute(sql`
      update organization_phones
      set
        number = ${mutation.paper.number.trim()},
        normalized_number = ${normalized},
        type = ${mutation.paper.type},
        extension = ${extension},
        normalized_extension = ${extension},
        label = ${mutation.paper.label},
        instructions = ${mutation.paper.instructions},
        status = ${mutation.paper.status},
        source = 'paper_note',
        source_paper_note_entry_id = ${mutation.sourcePaperNoteEntryId}::uuid,
        updated_at = ${now}
      where id = ${mutation.existingPhoneId}::uuid
        and organization_id = ${mutation.owner.organizationId}::uuid
        and organization_location_id is not distinct from ${mutation.owner.organizationLocationId}::uuid
      returning id, primary
    `));
    const row = result[0];
    if (!row) throw new PaperNotePhoneMutationError("PHONE_NOT_FOUND", "Saved organization phone was not found.");
    if (row.primary && mutation.paper.status === "active" && mutation.owner.organizationLocationId === null) {
      await this.syncLegacyPrimary(tx, mutation, normalized, now);
    }
    return { phoneId: row.id, action: "updated_same_phone" };
  }

  private async inactivateExisting(
    tx: PaperNoteTransaction,
    mutation: StructuredPhoneMutation,
    now: Date,
  ) {
    if (mutation.owner.kind === "contact") {
      const result = await rows<{ id: string }>(tx.execute(sql`
        update contact_phones
        set status = 'inactive', primary = false, updated_at = ${now}
        where id = ${mutation.existingPhoneId}::uuid
          and contact_id = ${mutation.owner.contactId}::uuid
        returning id
      `));
      if (!result.length) throw new PaperNotePhoneMutationError("PHONE_NOT_FOUND", "Saved contact phone was not found.");
      return;
    }
    const result = await rows<{ id: string }>(tx.execute(sql`
      update organization_phones
      set status = 'inactive', primary = false, updated_at = ${now}
      where id = ${mutation.existingPhoneId}::uuid
        and organization_id = ${mutation.owner.organizationId}::uuid
        and organization_location_id is not distinct from ${mutation.owner.organizationLocationId}::uuid
      returning id
    `));
    if (!result.length) throw new PaperNotePhoneMutationError("PHONE_NOT_FOUND", "Saved organization phone was not found.");
  }

  private async demotePrimary(tx: PaperNoteTransaction, mutation: StructuredPhoneMutation) {
    if (mutation.owner.kind === "contact") {
      await tx.execute(sql`
        update contact_phones
        set primary = false
        where contact_id = ${mutation.owner.contactId}::uuid
          and primary = true
      `);
      return;
    }
    await tx.execute(sql`
      update organization_phones
      set primary = false
      where organization_id = ${mutation.owner.organizationId}::uuid
        and organization_location_id is not distinct from ${mutation.owner.organizationLocationId}::uuid
        and primary = true
    `);
  }

  private async insertContactPhone(
    tx: PaperNoteTransaction,
    mutation: StructuredPhoneMutation,
    normalized: string,
    extension: string | null,
    status: "active" | "questionable" | "inactive",
    primary: boolean,
    now: Date,
  ) {
    if (mutation.owner.kind !== "contact") throw new Error("Contact owner expected.");
    const result = await rows<{ id: string }>(tx.execute(sql`
      insert into contact_phones (
        contact_id, number, normalized_number, type, extension, label, instructions,
        status, primary, source, source_paper_note_entry_id, created_at, updated_at
      ) values (
        ${mutation.owner.contactId}::uuid,
        ${mutation.paper.number.trim()},
        ${normalized},
        ${mutation.paper.type},
        ${extension},
        ${mutation.paper.label},
        ${mutation.paper.instructions},
        ${status},
        ${primary},
        'paper_note',
        ${mutation.sourcePaperNoteEntryId}::uuid,
        ${now},
        ${now}
      ) returning id
    `));
    const row = result[0];
    if (!row) throw new Error("Paper contact phone could not be created.");
    return row.id;
  }

  private async insertOrganizationPhone(
    tx: PaperNoteTransaction,
    mutation: StructuredPhoneMutation,
    normalized: string,
    extension: string | null,
    status: "active" | "questionable" | "inactive",
    primary: boolean,
    now: Date,
  ) {
    if (mutation.owner.kind !== "organization") throw new Error("Organization owner expected.");
    const result = await rows<{ id: string }>(tx.execute(sql`
      insert into organization_phones (
        organization_id, organization_location_id, number, normalized_number,
        type, extension, normalized_extension, label, instructions, status,
        primary, source, source_paper_note_entry_id, created_at, updated_at
      ) values (
        ${mutation.owner.organizationId}::uuid,
        ${mutation.owner.organizationLocationId}::uuid,
        ${mutation.paper.number.trim()},
        ${normalized},
        ${mutation.paper.type},
        ${extension},
        ${extension},
        ${mutation.paper.label},
        ${mutation.paper.instructions},
        ${status},
        ${primary},
        'paper_note',
        ${mutation.sourcePaperNoteEntryId}::uuid,
        ${now},
        ${now}
      ) returning id
    `));
    const row = result[0];
    if (!row) throw new Error("Paper organization phone could not be created.");
    return row.id;
  }

  private async syncLegacyPrimary(
    tx: PaperNoteTransaction,
    mutation: StructuredPhoneMutation,
    normalized: string,
    now: Date,
  ) {
    if (mutation.owner.kind === "contact") {
      await tx.execute(sql`
        update contacts
        set phone = ${mutation.paper.number.trim()}, normalized_phone = ${normalized}, updated_at = ${now}
        where id = ${mutation.owner.contactId}::uuid
      `);
      return;
    }
    if (mutation.owner.organizationLocationId === null) {
      await tx.execute(sql`
        update organizations
        set phone = ${mutation.paper.number.trim()}, normalized_phone = ${normalized}, updated_at = ${now}
        where id = ${mutation.owner.organizationId}::uuid
      `);
    }
  }
}
