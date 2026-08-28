import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  googleOperationalCalendarLinks,
  googleOperationalCalendarReviews,
  type OperationalCalendarPackageKey,
} from "@/db/schema";

type DrizzleDatabase = typeof database;

export type OperationalCalendarLink = {
  id: string;
  connectionId: string;
  calendarId: string;
  googleEventId: string;
  bookingId: string;
  packageKey: OperationalCalendarPackageKey;
  etag: string | null;
  sourceChecksum: string;
  lastAppSnapshot: Record<string, unknown>;
  reservedStartsAt: Date;
  reservedEndsAt: Date;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
};

function toLink(row: typeof googleOperationalCalendarLinks.$inferSelect): OperationalCalendarLink {
  return {
    id: row.id,
    connectionId: row.connectionId,
    calendarId: row.calendarId,
    googleEventId: row.googleEventId,
    bookingId: row.bookingId,
    packageKey: row.packageKey,
    etag: row.etag,
    sourceChecksum: row.sourceChecksum,
    lastAppSnapshot: row.lastAppSnapshot,
    reservedStartsAt: row.reservedStartsAt,
    reservedEndsAt: row.reservedEndsAt,
    lastSyncedAt: row.lastSyncedAt,
    lastErrorCode: row.lastErrorCode,
  };
}

export class OperationalCalendarLinkRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async findByBookingPackage(input: {
    connectionId: string;
    calendarId: string;
    bookingId: string;
    packageKey: OperationalCalendarPackageKey;
  }): Promise<OperationalCalendarLink | null> {
    const [row] = await this.db.select().from(googleOperationalCalendarLinks).where(and(
      eq(googleOperationalCalendarLinks.connectionId, input.connectionId),
      eq(googleOperationalCalendarLinks.calendarId, input.calendarId),
      eq(googleOperationalCalendarLinks.bookingId, input.bookingId),
      eq(googleOperationalCalendarLinks.packageKey, input.packageKey),
    )).limit(1);
    return row ? toLink(row) : null;
  }

  async listByBooking(input: {
    connectionId: string;
    calendarId: string;
    bookingId: string;
  }): Promise<OperationalCalendarLink[]> {
    const rows = await this.db.select().from(googleOperationalCalendarLinks).where(and(
      eq(googleOperationalCalendarLinks.connectionId, input.connectionId),
      eq(googleOperationalCalendarLinks.calendarId, input.calendarId),
      eq(googleOperationalCalendarLinks.bookingId, input.bookingId),
    ));
    return rows.map(toLink);
  }

  async findByGoogleEvent(input: {
    connectionId: string;
    calendarId: string;
    googleEventId: string;
  }): Promise<OperationalCalendarLink | null> {
    const [row] = await this.db.select().from(googleOperationalCalendarLinks).where(and(
      eq(googleOperationalCalendarLinks.connectionId, input.connectionId),
      eq(googleOperationalCalendarLinks.calendarId, input.calendarId),
      eq(googleOperationalCalendarLinks.googleEventId, input.googleEventId),
    )).limit(1);
    return row ? toLink(row) : null;
  }

  async saveSuccessfulSync(input: {
    connectionId: string;
    calendarId: string;
    googleEventId: string;
    bookingId: string;
    packageKey: OperationalCalendarPackageKey;
    etag: string | null;
    sourceChecksum: string;
    lastAppSnapshot: Record<string, unknown>;
    reservedStartsAt: Date;
    reservedEndsAt: Date;
    syncedAt: Date;
  }): Promise<OperationalCalendarLink> {
    const [row] = await this.db.insert(googleOperationalCalendarLinks).values({
      connectionId: input.connectionId,
      calendarId: input.calendarId,
      googleEventId: input.googleEventId,
      bookingId: input.bookingId,
      packageKey: input.packageKey,
      etag: input.etag,
      sourceChecksum: input.sourceChecksum,
      lastAppSnapshot: input.lastAppSnapshot,
      reservedStartsAt: input.reservedStartsAt,
      reservedEndsAt: input.reservedEndsAt,
      lastSyncedAt: input.syncedAt,
      lastErrorCode: null,
    }).onConflictDoUpdate({
      target: [
        googleOperationalCalendarLinks.connectionId,
        googleOperationalCalendarLinks.calendarId,
        googleOperationalCalendarLinks.bookingId,
        googleOperationalCalendarLinks.packageKey,
      ],
      set: {
        googleEventId: input.googleEventId,
        etag: input.etag,
        sourceChecksum: input.sourceChecksum,
        lastAppSnapshot: input.lastAppSnapshot,
        reservedStartsAt: input.reservedStartsAt,
        reservedEndsAt: input.reservedEndsAt,
        lastSyncedAt: input.syncedAt,
        lastErrorCode: null,
        updatedAt: input.syncedAt,
      },
    }).returning();
    if (!row) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_LINK_SAVE_FAILED");
    return toLink(row);
  }

  async recordSyncError(input: { linkId: string; errorCode: string; now: Date }): Promise<void> {
    await this.db.update(googleOperationalCalendarLinks)
      .set({ lastErrorCode: input.errorCode, updatedAt: input.now })
      .where(eq(googleOperationalCalendarLinks.id, input.linkId));
  }

  async createReview(input: {
    connectionId: string;
    linkId?: string | null;
    bookingId?: string | null;
    calendarId: string;
    googleEventId: string;
    reason: string;
    proposedChanges: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(googleOperationalCalendarReviews).values({
      connectionId: input.connectionId,
      linkId: input.linkId ?? null,
      bookingId: input.bookingId ?? null,
      calendarId: input.calendarId,
      googleEventId: input.googleEventId,
      reason: input.reason,
      proposedChanges: input.proposedChanges,
      state: "pending",
    }).onConflictDoNothing();
  }

  async listPendingReviews(connectionId: string) {
    return this.db.select().from(googleOperationalCalendarReviews).where(and(
      eq(googleOperationalCalendarReviews.connectionId, connectionId),
      eq(googleOperationalCalendarReviews.state, "pending"),
    ));
  }
}
