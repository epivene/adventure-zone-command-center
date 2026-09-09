import { allocationEnabled } from "@/features/outreach-planner/outreach-allocation";
import { commitmentTransaction, reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { and, eq, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  activities,
  bookingContacts,
  bookings,
  callSessions,
  contactPhones,
  contacts,
  followUps,
  organizationContacts,
  organizations,
} from "@/db/schema";
import type { BookingStatus } from "@/features/bookings/booking-types";
import { recordAuditEntry } from "@/features/audit/audit-service";
import {
  patchContactInTransaction,
  type ContactPatchWriter,
} from "@/features/contacts/contact-repository";
import type { ContactFields } from "@/features/contacts/contact-types";
import type {
  CallBooking,
  CallContext,
  CallFollowUp,
  CallOrganization,
  CallDirection,
  CallMethod,
  CallScriptKind,
  CompleteCallInput,
  PersistedCallDisposition,
} from "@/features/calls/call-types";

export type ExistingCallSession = {
  id: string;
  noteActivityId: string;
  disposition: PersistedCallDisposition;
  nextFollowUpId: string | null;
  resultingBookingStatus: BookingStatus | null;
};

export type CallPhoneSnapshot = { id: string; number: string; extension: string | null; };

export type CallAuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export interface CallTransaction {
  lockRequest(requestKey: string): Promise<ExistingCallSession | null>;
  lockContext(input: CompleteCallInput): Promise<CallContext>;
  lockContactPhone(phoneId: string, contactId: string): Promise<CallPhoneSnapshot | null>;
  markPhoneDoNotCall(phoneId: string, reason: string, at: Date): Promise<void>;
  createActivity(input: {
    organizationId: string | null;
    contactId: string | null;
    bookingId: string | null;
    body: string;
    occurredAt: Date;
  }): Promise<{ id: string }>;
  createCallSession(input: {
    requestKey: string;
    organizationId: string | null;
    contactId: string | null;
    phoneId: string | null;
    direction: CallDirection;
    method: CallMethod;
    phoneNumberSnapshot: string | null;
    phoneExtensionSnapshot: string | null;
    scriptKind: CallScriptKind;
    bookingId: string | null;
    followUpId: string | null;
    nextFollowUpId: string | null;
    disposition: PersistedCallDisposition;
    resultingBookingStatus: BookingStatus | null;
    noteActivityId: string;
    startedAt: Date;
    endedAt: Date;
  }): Promise<{ id: string }>;
  completeFollowUp(followUpId: string, input: { outcome: string; completedAt: Date }): Promise<void>;
  createFollowUp(input: {
    organizationId: string | null;
    contactId: string | null;
    bookingId: string | null;
    kind: string;
    dueAt: Date;
  }): Promise<{ id: string }>;
  linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void>;
  updateBooking(bookingId: string, updates: Record<string, unknown>): Promise<CallBooking>;
  updateContact(input: {
    contact: NonNullable<CallContext["contact"]>;
    organizationName: string | null;
    updates: Partial<ContactFields>;
    now: Date;
  }): Promise<Record<string, unknown>>;
  setLastResort(organizationId: string, reason: string, changedAt: Date): Promise<void>;
  createAuditEntry(input: CallAuditEntry): Promise<void>;
}

export interface CallRepository {
  transaction<T>(operation: (transaction: CallTransaction) => Promise<T>, bookingId?: string | null, followUpId?: string | null): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzleWriter = Pick<
  DrizzleDatabase,
  "delete" | "execute" | "select" | "insert" | "update"
>;

function organizationSnapshot(record: typeof organizations.$inferSelect): CallOrganization {
  return {
    id: record.id,
    name: record.name,
    lastResort: record.lastResort,
    lastResortReason: record.lastResortReason,
  };
}

function bookingSnapshot(record: typeof bookings.$inferSelect): CallBooking {
  return {
    ...record,
    organizationId: record.organizationId,
    primaryContactId: record.primaryContactId,
    status: record.status,
  };
}

function followUpSnapshot(record: typeof followUps.$inferSelect): CallFollowUp {
  return {
    id: record.id,
    bookingId: record.bookingId,
    organizationId: record.organizationId,
    contactId: record.contactId,
    completedAt: record.completedAt,
    outcome: record.outcome,
    nextFollowUpId: record.nextFollowUpId,
  };
}

class CallContextChangedWhileLockingError extends Error {
  constructor() {
    super("Call context changed while locks were acquired.");
    this.name = "CallContextChangedWhileLockingError";
  }
}

function contextDerivation(
  input: CompleteCallInput,
  records: {
    followUp: typeof followUps.$inferSelect | undefined;
    booking: typeof bookings.$inferSelect | undefined;
    contact: typeof contacts.$inferSelect | undefined;
  },
) {
  const bookingId = input.bookingId ?? records.followUp?.bookingId ?? null;
  const contactId =
    input.contactId ??
    records.followUp?.contactId ??
    records.booking?.primaryContactId ??
    null;
  const organizationId =
    input.organizationId ??
    records.followUp?.organizationId ??
    records.booking?.organizationId ??
    records.contact?.organizationId ??
    null;
  return {
    bookingId,
    contactId,
    organizationId,
    followUp: records.followUp
      ? {
          id: records.followUp.id,
          bookingId: records.followUp.bookingId,
          contactId: records.followUp.contactId,
          organizationId: records.followUp.organizationId,
        }
      : null,
    booking: records.booking
      ? {
          id: records.booking.id,
          organizationId: records.booking.organizationId,
          primaryContactId: records.booking.primaryContactId,
        }
      : null,
    contact: records.contact
      ? {
          id: records.contact.id,
          organizationId: records.contact.organizationId,
        }
      : null,
  };
}

class DrizzleCallTransaction implements CallTransaction {
  constructor(private readonly database: DrizzleWriter) {}

  async lockRequest(requestKey: string): Promise<ExistingCallSession | null> {
    await this.database.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`,
    );
    const [existing] = await this.database
      .select({
        id: callSessions.id,
        noteActivityId: callSessions.noteActivityId,
        disposition: callSessions.disposition,
        nextFollowUpId: callSessions.nextFollowUpId,
        resultingBookingStatus: callSessions.resultingBookingStatus,
      })
      .from(callSessions)
      .where(eq(callSessions.requestKey, requestKey))
      .limit(1)
      .for("update");
    if (!existing?.noteActivityId) return null;
    return {
      id: existing.id,
      noteActivityId: existing.noteActivityId,
      disposition: existing.disposition,
      nextFollowUpId: existing.nextFollowUpId,
      resultingBookingStatus: existing.resultingBookingStatus,
    };
  }

  async lockContext(input: CompleteCallInput): Promise<CallContext> {
    const [discoveredFollowUp] = input.followUpId
      ? await this.database
        .select()
        .from(followUps)
        .where(eq(followUps.id, input.followUpId))
        .limit(1)
      : [];
    const discoveredBookingId =
      input.bookingId ?? discoveredFollowUp?.bookingId ?? null;
    const [discoveredBooking] = discoveredBookingId
      ? await this.database
        .select()
        .from(bookings)
        .where(eq(bookings.id, discoveredBookingId))
        .limit(1)
      : [];
    const discoveredContactId =
      input.contactId ??
      discoveredFollowUp?.contactId ??
      discoveredBooking?.primaryContactId ??
      null;
    const [discoveredContact] = discoveredContactId
      ? await this.database
        .select()
        .from(contacts)
        .where(eq(contacts.id, discoveredContactId))
        .limit(1)
      : [];
    const discovered = contextDerivation(input, {
      followUp: discoveredFollowUp,
      booking: discoveredBooking,
      contact: discoveredContact,
    });

    const [organization] = discovered.organizationId
      ? await this.database
        .select()
        .from(organizations)
        .where(eq(organizations.id, discovered.organizationId))
        .limit(1)
        .for("update")
      : [];
    const [contact] = discovered.contactId
      ? await this.database
        .select()
        .from(contacts)
        .where(eq(contacts.id, discovered.contactId))
        .limit(1)
        .for("update")
      : [];
    const [booking] = discovered.bookingId
      ? await this.database
        .select()
        .from(bookings)
        .where(eq(bookings.id, discovered.bookingId))
        .limit(1)
        .for("update")
      : [];
    const [followUp] = input.followUpId
      ? await this.database
        .select()
        .from(followUps)
        .where(eq(followUps.id, input.followUpId))
        .limit(1)
        .for("update")
      : [];
    const locked = contextDerivation(input, { followUp, booking, contact });
    if (JSON.stringify(locked) !== JSON.stringify(discovered)) {
      throw new CallContextChangedWhileLockingError();
    }

    const { bookingId, contactId, organizationId } = locked;
    const [organizationContact] =
      organizationId && contactId
        ? await this.database
          .select({ id: organizationContacts.id })
          .from(organizationContacts)
          .where(and(
            eq(organizationContacts.organizationId, organizationId),
            eq(organizationContacts.contactId, contactId),
            eq(organizationContacts.active, true),
          ))
          .limit(1)
          .for("share")
        : [];
    const [bookingContact] =
      bookingId && contactId
        ? await this.database
          .select({ id: bookingContacts.id })
          .from(bookingContacts)
          .where(and(
            eq(bookingContacts.bookingId, bookingId),
            eq(bookingContacts.contactId, contactId),
          ))
          .limit(1)
          .for("share")
        : [];
    return {
      organization: organization ? organizationSnapshot(organization) : null,
      contact: contact ? { ...contact, organizationId: contact.organizationId } : null,
      booking: booking ? bookingSnapshot(booking) : null,
      followUp: followUp ? followUpSnapshot(followUp) : null,
      contactHasActiveOrganizationRelationship:
        organizationId && contactId ? Boolean(organizationContact) : null,
      contactHasBookingRelationship:
        bookingId && contactId ? Boolean(bookingContact) : null,
    };
  }

  async lockContactPhone(phoneId: string, contactId: string): Promise<CallPhoneSnapshot | null> {
    const [phone] = await this.database.select({ id: contactPhones.id, number: contactPhones.number, extension: contactPhones.extension }).from(contactPhones).where(and(eq(contactPhones.id, phoneId), eq(contactPhones.contactId, contactId))).limit(1).for("update");
    return phone ?? null;
  }

  async markPhoneDoNotCall(phoneId: string, reason: string, at: Date): Promise<void> {
    const [phone] = await this.database.update(contactPhones).set({ doNotCallAt: at, doNotCallReason: reason, updatedAt: at }).where(eq(contactPhones.id, phoneId)).returning({ id: contactPhones.id });
    if (!phone) throw new Error("Contact phone is missing.");
  }

  async createActivity(input: Parameters<CallTransaction["createActivity"]>[0]) {
    const now = new Date();
    const [activity] = await this.database.insert(activities).values({
      organizationId: input.organizationId,
      contactId: input.contactId,
      bookingId: input.bookingId,
      kind: "call",
      body: input.body,
      occurredAt: input.occurredAt,
      timelineSortAt: input.occurredAt,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: activities.id });
    if (!activity) throw new Error("Could not create call activity.");
    return activity;
  }

  async createCallSession(input: Parameters<CallTransaction["createCallSession"]>[0]) {
    const [session] = await this.database.insert(callSessions).values(input).returning({ id: callSessions.id });
    if (!session) throw new Error("Could not create call session.");
    return session;
  }

  async completeFollowUp(followUpId: string, input: { outcome: string; completedAt: Date }) {
    const [updated] = await this.database.update(followUps).set({ ...input, updatedAt: input.completedAt })
      .where(eq(followUps.id, followUpId)).returning({ id: followUps.id });
    if (!updated) throw new Error("Follow-up is missing.");
  }

  async createFollowUp(input: Parameters<CallTransaction["createFollowUp"]>[0]) {
    const [followUp] = await this.database.insert(followUps).values(input).returning({ id: followUps.id });
    if (!followUp) throw new Error("Could not create call follow-up.");
    return followUp;
  }

  async linkNextFollowUp(followUpId: string, nextFollowUpId: string) {
    await this.database.update(followUps).set({ nextFollowUpId, updatedAt: new Date() })
      .where(eq(followUps.id, followUpId));
  }

  async updateBooking(bookingId: string, updates: Record<string, unknown>): Promise<CallBooking> {
    const [booking] = await this.database.update(bookings).set({ ...updates, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId)).returning();
    if (!booking) throw new Error("Booking is missing.");
    return bookingSnapshot(booking);
  }

  async updateContact(input: {
    contact: NonNullable<CallContext["contact"]>;
    organizationName: string;
    updates: Partial<ContactFields>;
    now: Date;
  }): Promise<Record<string, unknown>> {
    const updates = { ...input.updates };
    delete updates.organizationName;
    const patched = await patchContactInTransaction(
      this.database as ContactPatchWriter,
      input.contact as typeof contacts.$inferSelect,
      input.organizationName,
      updates,
      input.now,
    );
    return patched.snapshot;
  }

  async setLastResort(organizationId: string, reason: string, changedAt: Date) {
    const [organization] = await this.database.update(organizations).set({
      lastResort: true,
      lastResortReason: reason,
      lastResortChangedAt: changedAt,
      updatedAt: changedAt,
    }).where(eq(organizations.id, organizationId)).returning({ id: organizations.id });
    if (!organization) throw new Error("Organization is missing.");
  }

  createAuditEntry(input: CallAuditEntry): Promise<void> {
    return recordAuditEntry(this.database, input);
  }
}

export class DrizzleCallRepository implements CallRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async transaction<T>(operation: (transaction: CallTransaction) => Promise<T>, bookingId?: string | null, followUpId?: string | null): Promise<T> {
    if(allocationEnabled() && !bookingId && followUpId) bookingId=(await this.database.select({bookingId:followUps.bookingId}).from(followUps).where(eq(followUps.id,followUpId)).limit(1))[0]?.bookingId;
    return commitmentTransaction(this.database, (transaction) => operation(new DrizzleCallTransaction(transaction)), {source:"call-completion",bookingIds:bookingId?[bookingId]:[]});
  }
}
