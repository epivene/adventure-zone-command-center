import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  activities,
  bookings,
  callSessions,
  contacts,
  followUps,
  organizations,
} from "@/db/schema";
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
  CompleteCallInput,
  PersistedCallDisposition,
} from "@/features/calls/call-types";

export type CallAuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export interface CallTransaction {
  lockContext(input: CompleteCallInput): Promise<CallContext>;
  createActivity(input: {
    organizationId: string;
    contactId: string | null;
    bookingId: string | null;
    body: string;
    occurredAt: Date;
  }): Promise<{ id: string }>;
  createCallSession(input: {
    organizationId: string;
    contactId: string | null;
    bookingId: string | null;
    followUpId: string | null;
    disposition: PersistedCallDisposition;
    noteActivityId: string;
    startedAt: Date;
    endedAt: Date;
  }): Promise<{ id: string }>;
  completeFollowUp(followUpId: string, input: { outcome: string; completedAt: Date }): Promise<void>;
  createFollowUp(input: {
    organizationId: string;
    contactId: string | null;
    bookingId: string | null;
    kind: string;
    dueAt: Date;
  }): Promise<{ id: string }>;
  linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void>;
  updateBooking(bookingId: string, updates: Record<string, unknown>): Promise<CallBooking>;
  updateContact(input: {
    contact: NonNullable<CallContext["contact"]>;
    organizationName: string;
    updates: Partial<ContactFields>;
    now: Date;
  }): Promise<Record<string, unknown>>;
  setLastResort(organizationId: string, reason: string, changedAt: Date): Promise<void>;
  createAuditEntry(input: CallAuditEntry): Promise<void>;
}

export interface CallRepository {
  transaction<T>(operation: (transaction: CallTransaction) => Promise<T>): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzleWriter = Pick<DrizzleDatabase, "select" | "insert" | "update">;

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

class DrizzleCallTransaction implements CallTransaction {
  constructor(private readonly database: DrizzleWriter) {}

  async lockContext(input: CompleteCallInput): Promise<CallContext> {
    const [organization] = await this.database.select().from(organizations)
      .where(eq(organizations.id, input.organizationId)).limit(1).for("update");
    let [contact] = input.contactId
      ? await this.database.select().from(contacts).where(eq(contacts.id, input.contactId)).limit(1).for("update")
      : [];
    let [booking] = input.bookingId
      ? await this.database.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1).for("update")
      : [];
    const [followUp] = input.followUpId
      ? await this.database.select().from(followUps).where(eq(followUps.id, input.followUpId)).limit(1).for("update")
      : [];
    if (!booking && followUp?.bookingId) {
      [booking] = await this.database.select().from(bookings)
        .where(eq(bookings.id, followUp.bookingId)).limit(1).for("update");
    }
    if (!contact && followUp?.contactId) {
      [contact] = await this.database.select().from(contacts)
        .where(eq(contacts.id, followUp.contactId)).limit(1).for("update");
    }
    return {
      organization: organization ? organizationSnapshot(organization) : null,
      contact: contact ? { ...contact, organizationId: contact.organizationId } : null,
      booking: booking ? bookingSnapshot(booking) : null,
      followUp: followUp ? followUpSnapshot(followUp) : null,
    };
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

  transaction<T>(operation: (transaction: CallTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => operation(new DrizzleCallTransaction(transaction)));
  }
}
