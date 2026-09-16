import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  auditEntries,
  activities,
  bookings,
  communicationTemplates,
  contacts,
  officeEmailDrafts,
  organizationContacts,
  designProjects,
  type OfficeEmailState,
} from "@/db/schema";
import {
  OfficeEmailError,
  canOfficeEditDraft,
  canOfficeSubmitDraft,
} from "./office-email-service";
import type { OfficeEmailDraftView } from "./office-email-types";
import { normalizeSendableContactEmail } from "@/features/contacts/contact-email-value";

type DrizzleDatabase = typeof database;

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}
export function officeEmailDraftView(
  row: typeof officeEmailDrafts.$inferSelect,
): OfficeEmailDraftView {
  return {
    id: row.id,
    officeAccountId: row.officeAccountId,
    organizationId: row.organizationId,
    contactId: row.contactId,
    bookingId: row.bookingId,
    eventYear: row.eventYear,
    communicationTemplateId: row.communicationTemplateId,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    body: row.body,
    bodyFormat: row.bodyFormat,
    designProjectId: row.designProjectId,
    designVersionId: row.designVersionId,
    coordinatorNote: row.coordinatorNote,
    state: row.state,
    submittedAt: iso(row.submittedAt),
    ownerReturnNote: row.ownerReturnNote,
    sentAt: iso(row.sentAt),
    scheduledFor: iso(row.scheduledFor),
    businessTimeZone: row.businessTimeZone,
    gmailDraftId: row.gmailDraftId,
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    dispatchAttemptCount: row.dispatchAttemptCount,
    lastFailureCode: row.lastFailureCode,
    lastFailureMessage: row.lastFailureMessage,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const view = officeEmailDraftView;

const unresolvedTemplateToken = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/;

export class DrizzleOfficeEmailRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async validateRecipient(
    transaction: any,
    organizationId: string,
    contactId: string,
  ) {
    const [row] = await transaction
      .select({ email: contacts.email })
      .from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(
        and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.contactId, contactId),
          eq(organizationContacts.active, true),
        ),
      )
      .limit(1);
    if (!row) throw new OfficeEmailError("CONTACT_NOT_LINKED");
    const email = normalizeSendableContactEmail(row.email);
    if (!email) throw new OfficeEmailError("EMAIL_REQUIRED");
    return email;
  }

  async resolveDesignRecipient(input: {
    projectId: string;
    accountId: string;
  }) {
    const [row] = await this.database
      .select({
        organizationId: designProjects.linkedOrganizationId,
        contactId: designProjects.linkedContactId,
        email: contacts.email,
      })
      .from(designProjects)
      .innerJoin(
        organizationContacts,
        and(
          eq(
            organizationContacts.organizationId,
            designProjects.linkedOrganizationId,
          ),
          eq(organizationContacts.contactId, designProjects.linkedContactId),
          eq(organizationContacts.active, true),
        ),
      )
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(
        and(
          eq(designProjects.id, input.projectId),
          eq(designProjects.officeAccountId, input.accountId),
          eq(designProjects.type, "email"),
        ),
      )
      .limit(1);
    if (!row?.organizationId || !row.contactId) {
      throw new OfficeEmailError("CONTACT_NOT_LINKED");
    }
    const recipientEmail = normalizeSendableContactEmail(row.email);
    if (!recipientEmail) throw new OfficeEmailError("EMAIL_REQUIRED");
    return {
      organizationId: row.organizationId,
      contactId: row.contactId,
      recipientEmail,
    };
  }

  async saveCanonicalDesignDraft(input: {
    accountId: string;
    projectId: string;
    versionId: string;
    organizationId: string;
    contactId: string;
    recipientEmail: string;
    subject: string;
    html: string;
  }) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(officeEmailDrafts)
        .where(eq(officeEmailDrafts.designProjectId, input.projectId))
        .limit(1)
        .for("update");
      if (existing) {
        if (existing.officeAccountId !== input.accountId) {
          throw new OfficeEmailError("NOT_FOUND");
        }
        if (
          ![
            "draft",
            "gmail_draft",
            "needs_changes",
            "failed",
            "cancelled",
          ].includes(existing.state)
        ) {
          throw new OfficeEmailError("INVALID_STATE");
        }
        const [updated] = await transaction
          .update(officeEmailDrafts)
          .set({
            organizationId: input.organizationId,
            contactId: input.contactId,
            recipientEmail: input.recipientEmail,
            subject: input.subject.trim(),
            body: input.html,
            bodyFormat: "html",
            designVersionId: input.versionId,
            state: "draft",
            scheduledFor: null,
            businessTimeZone: null,
            scheduleRequestKey: null,
            sendRequestKey: null,
            nextAttemptAt: null,
            lastFailureCode: null,
            lastFailureMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(officeEmailDrafts.id, existing.id))
          .returning();
        if (!updated) throw new OfficeEmailError("NOT_FOUND");
        return view(updated);
      }

      const [created] = await transaction
        .insert(officeEmailDrafts)
        .values({
          officeAccountId: input.accountId,
          organizationId: input.organizationId,
          contactId: input.contactId,
          recipientEmail: input.recipientEmail,
          subject: input.subject.trim(),
          body: input.html,
          bodyFormat: "html",
          designProjectId: input.projectId,
          designVersionId: input.versionId,
          state: "draft",
          lastFailureCode: null,
          lastFailureMessage: null,
          updatedAt: new Date(),
        })
        .returning();
      if (!created) throw new OfficeEmailError("NOT_FOUND");
      return view(created);
    });
  }

  async markCanonicalGmailDraft(input: {
    draftId: string;
    accountId: string;
    gmailDraftId: string;
    gmailMessageId: string;
    gmailThreadId: string | null;
  }) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        state: "gmail_draft",
        gmailDraftId: input.gmailDraftId,
        gmailMessageId: input.gmailMessageId,
        gmailThreadId: input.gmailThreadId,
        lastFailureCode: null,
        lastFailureMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.officeAccountId, input.accountId),
        ),
      )
      .returning();
    if (!row) throw new OfficeEmailError("NOT_FOUND");
    return view(row);
  }

  async markCanonicalDraftFailed(input: {
    draftId: string;
    accountId: string;
    code: string;
    message: string;
  }) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        state: "failed",
        lastFailureCode: input.code.slice(0, 120),
        lastFailureMessage: input.message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.officeAccountId, input.accountId),
        ),
      )
      .returning();
    if (!row) throw new OfficeEmailError("NOT_FOUND");
    return view(row);
  }

  async findCanonicalByScheduleRequest(input: {
    accountId: string;
    requestKey: string;
  }) {
    const [row] = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(
        and(
          eq(officeEmailDrafts.officeAccountId, input.accountId),
          eq(officeEmailDrafts.scheduleRequestKey, input.requestKey),
        ),
      )
      .limit(1);
    return row ? view(row) : null;
  }

  async findCanonicalByProject(input: {
    projectId: string;
    accountId: string;
  }) {
    const [row] = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(
        and(
          eq(officeEmailDrafts.designProjectId, input.projectId),
          eq(officeEmailDrafts.officeAccountId, input.accountId),
        ),
      )
      .limit(1);
    return row ? view(row) : null;
  }

  async findCanonicalBySendRequest(input: {
    accountId: string;
    requestKey: string;
  }) {
    const [row] = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(
        and(
          eq(officeEmailDrafts.officeAccountId, input.accountId),
          eq(officeEmailDrafts.sendRequestKey, input.requestKey),
        ),
      )
      .limit(1);
    return row ? view(row) : null;
  }

  async scheduleCanonicalDraft(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
    scheduledFor: Date;
    businessTimeZone: string;
  }) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .update(officeEmailDrafts)
        .set({
          state: "scheduled",
          scheduleRequestKey: input.requestKey,
          scheduledFor: input.scheduledFor,
          businessTimeZone: input.businessTimeZone,
          nextAttemptAt: input.scheduledFor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(officeEmailDrafts.id, input.draftId),
            eq(officeEmailDrafts.officeAccountId, input.accountId),
            eq(officeEmailDrafts.state, "draft"),
          ),
        )
        .returning();
      if (!row) throw new OfficeEmailError("INVALID_STATE");
      await transaction.insert(activities).values({
        organizationId: row.organizationId,
        contactId: row.contactId,
        kind: "note",
        subject: "Email scheduled",
        body: "A profile email is scheduled for delivery.",
        occurredAt: new Date(),
        timelineSortAt: new Date(),
      });
      return view(row);
    });
  }

  async rescheduleCanonicalDraft(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
    scheduledFor: Date;
    businessTimeZone: string;
  }) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        scheduleRequestKey: input.requestKey,
        scheduledFor: input.scheduledFor,
        businessTimeZone: input.businessTimeZone,
        nextAttemptAt: input.scheduledFor,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.officeAccountId, input.accountId),
          eq(officeEmailDrafts.state, "scheduled"),
        ),
      )
      .returning();
    if (!row) throw new OfficeEmailError("INVALID_STATE");
    return view(row);
  }

  async cancelCanonicalSchedule(input: { draftId: string; accountId: string }) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        state: "cancelled",
        nextAttemptAt: null,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.officeAccountId, input.accountId),
          eq(officeEmailDrafts.state, "scheduled"),
        ),
      )
      .returning();
    if (!row) throw new OfficeEmailError("INVALID_STATE");
    return view(row);
  }

  async claimCanonicalSend(input: {
    draftId: string;
    accountId: string;
    requestKey: string;
  }) {
    const now = new Date();
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        state: "sending",
        sendRequestKey: input.requestKey,
        lastAttemptAt: now,
        dispatchAttemptCount: sql`${officeEmailDrafts.dispatchAttemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.officeAccountId, input.accountId),
          inArray(officeEmailDrafts.state, ["draft", "gmail_draft"]),
        ),
      )
      .returning();
    if (!row) throw new OfficeEmailError("SEND_LOCKED");
    return view(row);
  }

  async markCanonicalSent(input: {
    draftId: string;
    accountId: string;
    gmailDraftId: string;
    gmailMessageId: string;
    gmailThreadId: string;
    sentAt: Date;
    workerId?: string;
  }) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .update(officeEmailDrafts)
        .set({
          state: "sent",
          gmailDraftId: input.gmailDraftId,
          gmailMessageId: input.gmailMessageId,
          gmailThreadId: input.gmailThreadId,
          sentMessageId: input.gmailMessageId,
          sentAt: input.sentAt,
          dispatchLeaseOwner: null,
          dispatchLeaseExpiresAt: null,
          lastFailureCode: null,
          lastFailureMessage: null,
          updatedAt: input.sentAt,
        })
        .where(
          and(
            eq(officeEmailDrafts.id, input.draftId),
            eq(officeEmailDrafts.officeAccountId, input.accountId),
            eq(officeEmailDrafts.state, "sending"),
            input.workerId
              ? eq(officeEmailDrafts.dispatchLeaseOwner, input.workerId)
              : undefined,
          ),
        )
        .returning();
      if (!row) throw new OfficeEmailError("SEND_LOCKED");
      await transaction.insert(activities).values({
        organizationId: row.organizationId,
        contactId: row.contactId,
        kind: "note",
        subject: "Email sent",
        body: "A profile email was sent through Gmail.",
        occurredAt: input.sentAt,
        timelineSortAt: input.sentAt,
      });
      return view(row);
    });
  }

  async claimOneDue(input: { workerId: string; now: Date; leaseMs: number }) {
    return this.database.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(officeEmailDrafts)
        .where(
          or(
            and(
              eq(officeEmailDrafts.state, "scheduled"),
              lte(officeEmailDrafts.scheduledFor, input.now),
              or(
                isNull(officeEmailDrafts.nextAttemptAt),
                lte(officeEmailDrafts.nextAttemptAt, input.now),
              ),
              or(
                isNull(officeEmailDrafts.dispatchLeaseExpiresAt),
                lte(officeEmailDrafts.dispatchLeaseExpiresAt, input.now),
              ),
            ),
            and(
              eq(officeEmailDrafts.state, "sending"),
              lte(officeEmailDrafts.dispatchLeaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(officeEmailDrafts.scheduledFor), asc(officeEmailDrafts.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;
      const sendRequestKey = `scheduled:${candidate.id}:${candidate.designVersionId ?? "missing-version"}`;
      const [claimed] = await transaction
        .update(officeEmailDrafts)
        .set({
          state: "sending",
          sendRequestKey,
          dispatchLeaseOwner: input.workerId,
          dispatchLeaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          dispatchAttemptCount: sql`${officeEmailDrafts.dispatchAttemptCount} + 1`,
          lastAttemptAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(officeEmailDrafts.id, candidate.id))
        .returning();
      if (!claimed) return null;
      return { draft: view(claimed), sendRequestKey };
    });
  }

  async storeClaimedGmailDraft(input: {
    draftId: string;
    workerId: string;
    gmailDraftId: string;
    gmailMessageId: string;
    gmailThreadId: string | null;
  }) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        gmailDraftId: input.gmailDraftId,
        gmailMessageId: input.gmailMessageId,
        gmailThreadId: input.gmailThreadId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.state, "sending"),
          eq(officeEmailDrafts.dispatchLeaseOwner, input.workerId),
        ),
      )
      .returning();
    if (!row) throw new OfficeEmailError("SEND_LOCKED");
    return view(row);
  }

  async recordClaimedFailure(input: {
    draftId: string;
    workerId: string;
    retryable: boolean;
    nextAttemptAt: Date | null;
    code: string;
    message: string;
  }) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({
        state: input.retryable ? "scheduled" : "failed",
        nextAttemptAt: input.nextAttemptAt,
        dispatchLeaseOwner: null,
        dispatchLeaseExpiresAt: null,
        lastFailureCode: input.code.slice(0, 120),
        lastFailureMessage: input.message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, input.draftId),
          eq(officeEmailDrafts.state, "sending"),
          eq(officeEmailDrafts.dispatchLeaseOwner, input.workerId),
        ),
      )
      .returning();
    return row ? view(row) : null;
  }

  async validateTemplate(transaction: any, templateId: string | null) {
    if (!templateId) return;
    const [row] = await transaction
      .select({ id: communicationTemplates.id })
      .from(communicationTemplates)
      .where(
        and(
          eq(communicationTemplates.id, templateId),
          eq(communicationTemplates.state, "active"),
          eq(communicationTemplates.accessScope, "office"),
        ),
      )
      .limit(1);
    if (!row) throw new OfficeEmailError("INVALID_TEMPLATE");
  }

  async validateBooking(
    transaction: any,
    organizationId: string,
    bookingId: string | null,
  ) {
    if (!bookingId) return;
    const [row] = await transaction
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) throw new OfficeEmailError("INVALID_BOOKING");
  }

  async listForOffice(accountId: string) {
    const rows = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(eq(officeEmailDrafts.officeAccountId, accountId))
      .orderBy(desc(officeEmailDrafts.updatedAt));
    return rows.map(view);
  }

  async listNeedsChanges(accountId: string) {
    const rows = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(
        and(
          eq(officeEmailDrafts.officeAccountId, accountId),
          eq(officeEmailDrafts.state, "needs_changes"),
        ),
      )
      .orderBy(desc(officeEmailDrafts.updatedAt));
    return rows.map(view);
  }

  async listForProfile(organizationId: string) {
    const rows = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(
        and(
          eq(officeEmailDrafts.organizationId, organizationId),
          isNull(officeEmailDrafts.officeAccountId),
        ),
      )
      .orderBy(desc(officeEmailDrafts.updatedAt));
    return rows.map(view);
  }

  async createForOwner(input: {
    organizationId: string;
    contactId: string;
    subject: string;
    body: string;
  }) {
    return this.createForOffice({
      ...input,
      accountId: null,
      communicationTemplateId: null,
      bookingId: null,
      eventYear: null,
      coordinatorNote: null,
    });
  }

  async updateForOwner(
    draftId: string,
    input: { subject: string; body: string },
  ) {
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
      const recipientEmail = await this.validateRecipient(
        transaction,
        input.organizationId,
        input.contactId,
      );
      await this.validateTemplate(transaction, input.communicationTemplateId);
      await this.validateBooking(
        transaction,
        input.organizationId,
        input.bookingId,
      );
      const [row] = await transaction
        .insert(officeEmailDrafts)
        .values({
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
        })
        .returning();
      if (!row) throw new Error("Email draft could not be created.");
      return view(row);
    });
  }

  async updateForOffice(
    draftId: string,
    accountId: string | null,
    input: { subject?: string; body?: string; coordinatorNote?: string | null },
  ) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(officeEmailDrafts)
        .where(
          and(
            eq(officeEmailDrafts.id, draftId),
            accountId === null
              ? isNull(officeEmailDrafts.officeAccountId)
              : eq(officeEmailDrafts.officeAccountId, accountId),
          ),
        )
        .limit(1)
        .for("update");
      if (!before) throw new OfficeEmailError("NOT_FOUND");
      if (!canOfficeEditDraft(before.state))
        throw new OfficeEmailError("INVALID_STATE");
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.subject !== undefined) set.subject = input.subject.trim();
      if (input.body !== undefined) set.body = input.body.trim();
      if (input.coordinatorNote !== undefined)
        set.coordinatorNote = input.coordinatorNote?.trim() || null;
      const [row] = await transaction
        .update(officeEmailDrafts)
        .set(set)
        .where(eq(officeEmailDrafts.id, draftId))
        .returning();
      if (!row) throw new OfficeEmailError("NOT_FOUND");
      return view(row);
    });
  }

  async submitForOffice(draftId: string, accountId: string, actorName: string) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(officeEmailDrafts)
        .where(
          and(
            eq(officeEmailDrafts.id, draftId),
            eq(officeEmailDrafts.officeAccountId, accountId),
          ),
        )
        .limit(1)
        .for("update");
      if (!before) throw new OfficeEmailError("NOT_FOUND");
      if (!canOfficeSubmitDraft(before.state))
        throw new OfficeEmailError("INVALID_STATE");
      if (unresolvedTemplateToken.test(`${before.subject}\n${before.body}`)) {
        throw new OfficeEmailError("UNRESOLVED_TEMPLATE_FIELD");
      }
      const recipientEmail = await this.validateRecipient(
        transaction,
        before.organizationId,
        before.contactId,
      );
      const now = new Date();
      const [row] = await transaction
        .update(officeEmailDrafts)
        .set({
          recipientEmail,
          state: "submitted",
          submittedAt: now,
          ownerReturnNote: null,
          lastSendError: null,
          updatedAt: now,
        })
        .where(eq(officeEmailDrafts.id, draftId))
        .returning();
      if (!row) throw new OfficeEmailError("NOT_FOUND");
      await transaction.insert(auditEntries).values({
        entityType: "office_email_draft",
        entityId: row.id,
        action: "office_email_submitted",
        before: { state: before.state },
        after: {
          state: "submitted",
          officeAccountId: accountId,
          officeDisplayName: actorName,
          recipientEmail,
          communicationTemplateId: before.communicationTemplateId,
        },
      });
      return view(row);
    });
  }

  async listForOwner(state?: OfficeEmailState | null) {
    const rows = await this.database
      .select()
      .from(officeEmailDrafts)
      .where(state ? eq(officeEmailDrafts.state, state) : undefined)
      .orderBy(
        desc(officeEmailDrafts.submittedAt),
        desc(officeEmailDrafts.updatedAt),
      );
    return rows;
  }

  async returnForChanges(draftId: string, note: string) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(officeEmailDrafts)
        .where(eq(officeEmailDrafts.id, draftId))
        .limit(1)
        .for("update");
      if (!before) throw new OfficeEmailError("NOT_FOUND");
      if (before.state !== "submitted")
        throw new OfficeEmailError("INVALID_STATE");
      const now = new Date();
      const [row] = await transaction
        .update(officeEmailDrafts)
        .set({
          state: "needs_changes",
          ownerReturnNote: note.trim(),
          updatedAt: now,
        })
        .where(eq(officeEmailDrafts.id, draftId))
        .returning();
      await transaction.insert(auditEntries).values({
        entityType: "office_email_draft",
        entityId: draftId,
        action: "office_email_returned",
        before: { state: before.state },
        after: { state: "needs_changes", ownerReturnNote: note.trim() },
      });
      return row!;
    });
  }

  async claimForSend(draftId: string) {
    const [row] = await this.database
      .update(officeEmailDrafts)
      .set({ state: "sending", updatedAt: new Date() })
      .where(
        and(
          eq(officeEmailDrafts.id, draftId),
          eq(officeEmailDrafts.state, "submitted"),
        ),
      )
      .returning();
    if (!row) {
      const [existing] = await this.database
        .select({ state: officeEmailDrafts.state })
        .from(officeEmailDrafts)
        .where(eq(officeEmailDrafts.id, draftId))
        .limit(1);
      if (!existing) throw new OfficeEmailError("NOT_FOUND");
      throw new OfficeEmailError("SEND_LOCKED");
    }
    const template = row.communicationTemplateId
      ? (
          await this.database
            .select({
              code: communicationTemplates.code,
              category: communicationTemplates.category,
            })
            .from(communicationTemplates)
            .where(eq(communicationTemplates.id, row.communicationTemplateId))
            .limit(1)
        )[0]
      : null;
    return {
      ...row,
      templateCode: template?.code ?? null,
      templateCategory: template?.category ?? null,
    };
  }

  async markSent(
    draftId: string,
    input: {
      recipientEmail: string;
      subject: string;
      body: string;
      messageId: string;
      sentAt: Date;
    },
  ) {
    return this.database.transaction(async (transaction) => {
      const now = input.sentAt;
      const [alreadySent] = await transaction
        .select()
        .from(officeEmailDrafts)
        .where(
          and(
            eq(officeEmailDrafts.id, draftId),
            eq(officeEmailDrafts.state, "sent"),
          ),
        )
        .limit(1);
      if (alreadySent && alreadySent.sentMessageId === input.messageId)
        return alreadySent;
      const [row] = await transaction
        .update(officeEmailDrafts)
        .set({
          recipientEmail: input.recipientEmail.trim().toLowerCase(),
          subject: input.subject.trim(),
          body: input.body,
          state: "sent",
          sentAt: now,
          sentMessageId: input.messageId,
          lastSendError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(officeEmailDrafts.id, draftId),
            eq(officeEmailDrafts.state, "sending"),
          ),
        )
        .returning();
      if (!row) throw new OfficeEmailError("SEND_LOCKED");
      await transaction.insert(auditEntries).values({
        entityType: "office_email_draft",
        entityId: draftId,
        action: "office_email_sent",
        before: { state: "sending" },
        after: {
          state: "sent",
          recipientEmail: input.recipientEmail,
          messageId: input.messageId,
        },
      });
      return row;
    });
  }

  async restoreSubmittedAfterFailure(draftId: string, error: string) {
    await this.database
      .update(officeEmailDrafts)
      .set({
        state: "submitted",
        lastSendError: error.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(officeEmailDrafts.id, draftId),
          eq(officeEmailDrafts.state, "sending"),
        ),
      );
  }
}
