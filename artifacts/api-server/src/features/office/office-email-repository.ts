import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  auditEntries,
  bookings,
  communicationTemplates,
  contacts,
  officeEmailDrafts,
  organizationContacts,
  type OfficeEmailState,
} from "@/db/schema";
import { OfficeEmailError, canOfficeEditDraft, canOfficeSubmitDraft } from "./office-email-service";
import type { OfficeEmailDraftView } from "./office-email-types";

type DrizzleDatabase = typeof database;

function iso(value: Date | null) { return value ? value.toISOString() : null; }
function view(row: typeof officeEmailDrafts.$inferSelect): OfficeEmailDraftView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    bookingId: row.bookingId,
    eventYear: row.eventYear,
    communicationTemplateId: row.communicationTemplateId,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    body: row.body,
    coordinatorNote: row.coordinatorNote,
    state: row.state,
    submittedAt: iso(row.submittedAt),
    ownerReturnNote: row.ownerReturnNote,
    sentAt: iso(row.sentAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const unresolvedTemplateToken = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/;

export class DrizzleOfficeEmailRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async validateRecipient(transaction: any, organizationId: string, contactId: string) {
    const [row] = await transaction
      .select({ email: contacts.email })
      .from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(and(
        eq(organizationContacts.organizationId, organizationId),
        eq(organizationContacts.contactId, contactId),
        eq(organizationContacts.active, true),
      ))
      .limit(1);
    if (!row) throw new OfficeEmailError("CONTACT_NOT_LINKED");
    const email = row.email?.trim().toLowerCase() ?? "";
    if (!email) throw new OfficeEmailError("EMAIL_REQUIRED");
    return email;
  }

  async validateTemplate(transaction: any, templateId: string | null) {
    if (!templateId) return;
    const [row] = await transaction
      .select({ id: communicationTemplates.id })
      .from(communicationTemplates)
      .where(and(
        eq(communicationTemplates.id, templateId),
        eq(communicationTemplates.state, "active"),
        eq(communicationTemplates.accessScope, "office"),
      ))
      .limit(1);
    if (!row) throw new OfficeEmailError("INVALID_TEMPLATE");
  }

  async validateBooking(transaction: any, organizationId: string, bookingId: string | null) {
    if (!bookingId) return;
    const [row] = await transaction.select({ id: bookings.id }).from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new OfficeEmailError("INVALID_BOOKING");
  }

  async listForOffice(accountId: string) {
    const rows = await this.database.select().from(officeEmailDrafts)
      .where(eq(officeEmailDrafts.officeAccountId, accountId))
      .orderBy(desc(officeEmailDrafts.updatedAt));
    return rows.map(view);
  }

  async listNeedsChanges(accountId: string) {
    const rows = await this.database.select().from(officeEmailDrafts)
      .where(and(eq(officeEmailDrafts.officeAccountId, accountId), eq(officeEmailDrafts.state, "needs_changes")))
      .orderBy(desc(officeEmailDrafts.updatedAt));
    return rows.map(view);
  }

  async listForProfile(organizationId: string) {
    const rows = await this.database.select().from(officeEmailDrafts)
      .where(and(eq(officeEmailDrafts.organizationId, organizationId), isNull(officeEmailDrafts.officeAccountId)))
      .orderBy(desc(officeEmailDrafts.updatedAt));
    return rows.map(view);
  }

  async createForOwner(input: { organizationId: string; contactId: string; subject: string; body: string }) {
    return this.createForOffice({ ...input, accountId: null, communicationTemplateId: null, bookingId: null, eventYear: null, coordinatorNote: null });
  }

  async updateForOwner(draftId: string, input: { subject: string; body: string }) {
    return this.updateForOffice(draftId, null, input);
  }

  async createForOffice(input: {
    accountId: string | null;
    organizationId: string;
    contactId: string;
    communicationTemplateId: string | null;
    bookingId: string | null;
    eventYear: number | null;
    subject: string;
    body: string;
    coordinatorNote: string | null;
  }) {
    return this.database.transaction(async (transaction) => {
      const recipientEmail = await this.validateRecipient(transaction, input.organizationId, input.contactId);
      await this.validateTemplate(transaction, input.communicationTemplateId);
      await this.validateBooking(transaction, input.organizationId, input.bookingId);
      const [row] = await transaction.insert(officeEmailDrafts).values({
        officeAccountId: input.accountId,
        organizationId: input.organizationId,
        contactId: input.contactId,
        communicationTemplateId: input.communicationTemplateId,
        bookingId: input.bookingId,
        eventYear: input.eventYear,
        recipientEmail,
        subject: input.subject.trim(),
        body: input.body.trim(),
        coordinatorNote: input.coordinatorNote?.trim() || null,
        state: "draft",
      }).returning();
      if (!row) throw new Error("Email draft could not be created.");
      return view(row);
    });
  }

  async updateForOffice(draftId: string, accountId: string | null, input: { subject?: string; body?: string; coordinatorNote?: string | null }) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction.select().from(officeEmailDrafts)
        .where(and(eq(officeEmailDrafts.id, draftId), accountId === null ? isNull(officeEmailDrafts.officeAccountId) : eq(officeEmailDrafts.officeAccountId, accountId)))
        .limit(1).for("update");
      if (!before) throw new OfficeEmailError("NOT_FOUND");
      if (!canOfficeEditDraft(before.state)) throw new OfficeEmailError("INVALID_STATE");
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.subject !== undefined) set.subject = input.subject.trim();
      if (input.body !== undefined) set.body = input.body.trim();
      if (input.coordinatorNote !== undefined) set.coordinatorNote = input.coordinatorNote?.trim() || null;
      const [row] = await transaction.update(officeEmailDrafts).set(set).where(eq(officeEmailDrafts.id, draftId)).returning();
      if (!row) throw new OfficeEmailError("NOT_FOUND");
      return view(row);
    });
  }

  async submitForOffice(draftId: string, accountId: string, actorName: string) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction.select().from(officeEmailDrafts)
        .where(and(eq(officeEmailDrafts.id, draftId), eq(officeEmailDrafts.officeAccountId, accountId)))
        .limit(1).for("update");
      if (!before) throw new OfficeEmailError("NOT_FOUND");
      if (!canOfficeSubmitDraft(before.state)) throw new OfficeEmailError("INVALID_STATE");
      if (unresolvedTemplateToken.test(`${before.subject}\n${before.body}`)) {
        throw new OfficeEmailError("UNRESOLVED_TEMPLATE_FIELD");
      }
      const recipientEmail = await this.validateRecipient(transaction, before.organizationId, before.contactId);
      const now = new Date();
      const [row] = await transaction.update(officeEmailDrafts).set({
        recipientEmail,
        state: "submitted",
        submittedAt: now,
        ownerReturnNote: null,
        lastSendError: null,
        updatedAt: now,
      }).where(eq(officeEmailDrafts.id, draftId)).returning();
      if (!row) throw new OfficeEmailError("NOT_FOUND");
      await transaction.insert(auditEntries).values({
        entityType: "office_email_draft",
        entityId: row.id,
        action: "office_email_submitted",
        before: { state: before.state },
        after: { state: "submitted", officeAccountId: accountId, officeDisplayName: actorName, recipientEmail, communicationTemplateId: before.communicationTemplateId },
      });
      return view(row);
    });
  }

  async listForOwner(state?: OfficeEmailState | null) {
    const rows = await this.database.select().from(officeEmailDrafts)
      .where(state ? eq(officeEmailDrafts.state, state) : undefined)
      .orderBy(desc(officeEmailDrafts.submittedAt), desc(officeEmailDrafts.updatedAt));
    return rows;
  }

  async returnForChanges(draftId: string, note: string) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction.select().from(officeEmailDrafts).where(eq(officeEmailDrafts.id, draftId)).limit(1).for("update");
      if (!before) throw new OfficeEmailError("NOT_FOUND");
      if (before.state !== "submitted") throw new OfficeEmailError("INVALID_STATE");
      const now = new Date();
      const [row] = await transaction.update(officeEmailDrafts).set({ state: "needs_changes", ownerReturnNote: note.trim(), updatedAt: now }).where(eq(officeEmailDrafts.id, draftId)).returning();
      await transaction.insert(auditEntries).values({ entityType: "office_email_draft", entityId: draftId, action: "office_email_returned", before: { state: before.state }, after: { state: "needs_changes", ownerReturnNote: note.trim() } });
      return row!;
    });
  }

  async claimForSend(draftId: string) {
    const [row] = await this.database.update(officeEmailDrafts).set({ state: "sending", updatedAt: new Date() })
      .where(and(eq(officeEmailDrafts.id, draftId), eq(officeEmailDrafts.state, "submitted")))
      .returning();
    if (!row) {
      const [existing] = await this.database.select({ state: officeEmailDrafts.state }).from(officeEmailDrafts).where(eq(officeEmailDrafts.id, draftId)).limit(1);
      if (!existing) throw new OfficeEmailError("NOT_FOUND");
      throw new OfficeEmailError("SEND_LOCKED");
    }
    const template = row.communicationTemplateId
      ? (await this.database
          .select({ code: communicationTemplates.code, category: communicationTemplates.category })
          .from(communicationTemplates)
          .where(eq(communicationTemplates.id, row.communicationTemplateId))
          .limit(1))[0]
      : null;
    return {
      ...row,
      templateCode: template?.code ?? null,
      templateCategory: template?.category ?? null,
    };
  }

  async markSent(draftId: string, input: { recipientEmail: string; subject: string; body: string; messageId: string; sentAt: Date }) {
    return this.database.transaction(async (transaction) => {
      const now = input.sentAt;
      const [row] = await transaction.update(officeEmailDrafts).set({
        recipientEmail: input.recipientEmail.trim().toLowerCase(),
        subject: input.subject.trim(),
        body: input.body,
        state: "sent",
        sentAt: now,
        sentMessageId: input.messageId,
        lastSendError: null,
        updatedAt: now,
      }).where(and(eq(officeEmailDrafts.id, draftId), eq(officeEmailDrafts.state, "sending"))).returning();
      if (!row) throw new OfficeEmailError("SEND_LOCKED");
      await transaction.insert(auditEntries).values({ entityType: "office_email_draft", entityId: draftId, action: "office_email_sent", before: { state: "sending" }, after: { state: "sent", recipientEmail: input.recipientEmail, messageId: input.messageId } });
      return row;
    });
  }

  async restoreSubmittedAfterFailure(draftId: string, error: string) {
    await this.database.update(officeEmailDrafts).set({ state: "submitted", lastSendError: error.slice(0, 1000), updatedAt: new Date() })
      .where(and(eq(officeEmailDrafts.id, draftId), eq(officeEmailDrafts.state, "sending")));
  }
}
