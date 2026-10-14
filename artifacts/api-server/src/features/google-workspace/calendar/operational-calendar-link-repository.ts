import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql, ilike, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOperationalWindows,
  bookingPackageSelections,
  bookings,
  organizations,
  packageTemplates,
  travelLegs,
  googleOperationalCalendarLinks,
  googleOperationalCalendarReviews,
  type OperationalCalendarPackageKey,
} from "@/db/schema";
import { parseOperationalEventDateText } from "./operational-calendar-matcher";

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

type ReviewChanges = {
  parsed?: {
    eventName?: string | null;
    city?: string | null;
    region?: string | null;
    packageKey?: string | null;
    managerToken?: string | null;
    actualEventDateText?: string | null;
    addressText?: string | null;
    originalDescription?: string | null;
    calendarState?: string | null;
  };
  google?: {
    summary?: string | null;
    description?: string | null;
    startDate?: string | null;
    endDateExclusive?: string | null;
    etag?: string | null;
  };
  candidateBookingIds?: unknown;
};

export type OperationalCalendarCandidate = {
  bookingId: string;
  profileId: string | null;
  bookingName: string;
  profileName: string | null;
  city: string;
  region: string;
  startsAt: Date | null;
  endsAt: Date | null;
  travelLegName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function reviewChanges(value: Record<string, unknown>): ReviewChanges {
  return value as ReviewChanges;
}

function dateOnly(value: unknown, label: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`GOOGLE_OPERATIONAL_CALENDAR_${label}_INVALID`);
  }
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new Error(`GOOGLE_OPERATIONAL_CALENDAR_${label}_INVALID`);
  }
  return result;
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseAddressLine(value: string | null | undefined) {
  return value?.split(/\n/).map((part) => part.trim()).find(Boolean) || null;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function packageCodeCandidates(key: OperationalCalendarPackageKey) {
  if (key === "zone") return ["adventure_zone", "mini_zone"];
  if (key === "pirates") return ["pirates_rebellion", "pirate_rebellion"];
  return ["weekend_warriors", "warriors_playground"];
}

function checksum(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

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
    return reconcileCapacityFacts(this.db,"calendar-sync",async tx => {
    const [row] = await tx.insert(googleOperationalCalendarLinks).values({
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
    });
  }

  async recordSyncError(input: { linkId: string; errorCode: string; now: Date }): Promise<void> {
    await reconcileCapacityFacts(this.db,"calendar-sync",async tx => {
    await tx.update(googleOperationalCalendarLinks)
      .set({ lastErrorCode: input.errorCode, updatedAt: input.now })
      .where(eq(googleOperationalCalendarLinks.id, input.linkId));
    });
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

  async listPendingReviews(connectionId?: string) {
    const pending = eq(googleOperationalCalendarReviews.state, "pending");
    const reviews = await this.db.select().from(googleOperationalCalendarReviews).where(
      connectionId
        ? and(eq(googleOperationalCalendarReviews.connectionId, connectionId), pending)
        : pending,
    );
    const candidateIds = [...new Set(reviews.flatMap((review) => {
      const proposed = reviewChanges(review.proposedChanges);
      return Array.isArray(proposed.candidateBookingIds)
        ? proposed.candidateBookingIds.filter((value): value is string => typeof value === "string")
        : [];
    }))];
    if (!candidateIds.length) return reviews;

    const candidates = await this.db.select({
      bookingId: bookings.id,
      profileId: organizations.id,
      bookingName: bookings.name,
      profileName: organizations.name,
      city: bookings.city,
      region: bookings.region,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      travelLegName: travelLegs.name,
    }).from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .where(inArray(bookings.id, candidateIds));
    const byId = new Map(candidates.map((candidate) => [candidate.bookingId, candidate]));
    return reviews.map((review) => {
      const proposed = reviewChanges(review.proposedChanges);
      const ids = Array.isArray(proposed.candidateBookingIds)
        ? proposed.candidateBookingIds.filter((value): value is string => typeof value === "string")
        : [];
      return {
        ...review,
        proposedChanges: {
          ...review.proposedChanges,
          candidateBookings: ids
            .map((id) => byId.get(id))
            .filter((candidate): candidate is typeof candidates[number] => Boolean(candidate)),
        },
      };
    });
  }

  async searchExistingBookings(query: string) {
    // No date/status/leg filters: older and cancelled bookings must be findable.
    const pattern = '%' + query.trim().replace(/[\\%_]/g, '\\$&') + '%';
    return this.db.select({
      bookingId: bookings.id, profileId: organizations.id,
      bookingName: bookings.name, profileName: organizations.name,
      city: bookings.city, region: bookings.region,
      startsAt: bookings.startsAt, endsAt: bookings.endsAt,
      travelLegName: travelLegs.name,
    }).from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .where(or(ilike(bookings.name, pattern), ilike(organizations.name, pattern),
        ilike(bookings.city, pattern), ilike(organizations.city, pattern)))
      .orderBy(bookings.name, bookings.id).limit(50);
  }

  async resolveReview(input: {
    reviewId: string;
    resolution: "link_existing" | "create_new";
    bookingId?: string;
    packageKey?: OperationalCalendarPackageKey;
    reviewedBy: string;
  }): Promise<{ state: "accepted"; bookingId: string; created: boolean }> {
    return reconcileCapacityFacts(this.db, "operational-calendar-link",async (tx) => {
      const [review] = await tx.select().from(googleOperationalCalendarReviews)
        .where(eq(googleOperationalCalendarReviews.id, input.reviewId))
        .limit(1)
        .for("update");
      if (!review) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_REVIEW_NOT_FOUND");
      if (review.state !== "pending") {
        if (!review.bookingId) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_REVIEW_ALREADY_RESOLVED");
        return { state: "accepted", bookingId: review.bookingId, created: false };
      }

      const changes = reviewChanges(review.proposedChanges);
      const parsed = changes.parsed ?? {};
      const google = changes.google ?? {};
      const packageKeyValue = input.packageKey ?? parsed.packageKey;
      if (packageKeyValue !== "zone" && packageKeyValue !== "pirates" && packageKeyValue !== "warrior") {
        throw new Error("GOOGLE_OPERATIONAL_CALENDAR_PACKAGE_REQUIRED");
      }
      const packageKey = packageKeyValue as OperationalCalendarPackageKey;
      const reservedStart = dateOnly(google.startDate, "RESERVED_START");
      const reservedEnd = dateOnly(google.endDateExclusive, "RESERVED_END");
      if (reservedEnd <= reservedStart) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_WINDOW_INVALID");
      const actualDates = parsed.actualEventDateText
        ? parseOperationalEventDateText(parsed.actualEventDateText, reservedStart.getUTCFullYear())
        : null;
      const publicDates = actualDates ?? {
        startsAt: reservedStart,
        endsAt: reservedEnd > reservedStart ? addUtcDays(reservedEnd, -1) : reservedStart,
      };
      const eventName = parsed.eventName?.trim() || google.summary?.trim() || "David calendar event";
      const city = parsed.city?.trim() || null;
      const region = parsed.region?.trim().toUpperCase() || null;
      let bookingId: string;
      let created = false;
      if (input.resolution === "link_existing") {
        if (!input.bookingId) {
          throw new Error("GOOGLE_OPERATIONAL_CALENDAR_CANDIDATE_INVALID");
        }
        const [existing] = await tx.select().from(bookings)
          .where(eq(bookings.id, input.bookingId))
          .limit(1)
          .for("update");
        if (!existing) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_BOOKING_NOT_FOUND");
        // Linking establishes identity; it does not authorize overwriting CRM facts.
        bookingId = existing.id;
      } else {
        if (parsed.calendarState === "cancelled" || /\bcancel(?:led|ed)\b/i.test(google.summary ?? "")) {
          throw new Error("GOOGLE_OPERATIONAL_CALENDAR_CANCELLED_CREATE_BLOCKED");
        }
        if (!city || !region) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_LOCATION_REQUIRED");
        const legId = await this.findLegId(tx, parsed.managerToken);
        const [organization] = await tx.insert(organizations).values({
          name: eventName,
          city,
          region,
          address1: parseAddressLine(parsed.addressText),
          placeType: "festival_event",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning({ id: organizations.id });
        if (!organization) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_PROFILE_CREATE_FAILED");
        const [booking] = await tx.insert(bookings).values({
          organizationId: organization.id,
          name: eventName,
          city,
          region,
          address1: parseAddressLine(parsed.addressText),
          startsAt: publicDates.startsAt,
          endsAt: publicDates.endsAt,
          status: "confirmed",
          probability: "definite" as any,
          travelLegId: legId,
          notes: parsed.originalDescription?.trim() || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning({ id: bookings.id });
        if (!booking) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_BOOKING_CREATE_FAILED");
        bookingId = booking.id;
        created = true;
      }

      if (created) {
        const templates = await tx.select({ id: packageTemplates.id, code: packageTemplates.code })
          .from(packageTemplates);
        const template = templates.find((item) => packageCodeCandidates(packageKey).includes(item.code));
        if (!template) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_PACKAGE_TEMPLATE_NOT_FOUND");
        await tx.insert(bookingPackageSelections).values({
          bookingId,
          packageTemplateId: template.id,
        }).onConflictDoNothing();
        await tx.insert(bookingOperationalWindows).values({
          bookingId,
          startsAt: reservedStart,
          endsAt: reservedEnd,
          source: "google_calendar",
        }).onConflictDoUpdate({
          target: bookingOperationalWindows.bookingId,
          set: { startsAt: reservedStart, endsAt: reservedEnd, source: "google_calendar", updatedAt: new Date() },
        });
      }

      const snapshot = {
        imported: true,
        summary: google.summary ?? null,
        description: google.description ?? null,
        startDate: google.startDate ?? null,
        endDateExclusive: google.endDateExclusive ?? null,
      };
      const savedLink = {
        connectionId: review.connectionId,
        calendarId: review.calendarId,
        googleEventId: review.googleEventId,
        bookingId,
        packageKey,
        etag: google.etag ?? null,
        sourceChecksum: checksum(snapshot),
        lastAppSnapshot: snapshot,
        reservedStartsAt: reservedStart,
        reservedEndsAt: reservedEnd,
        lastSyncedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      };
      const [conflictingLink] = await tx.select().from(googleOperationalCalendarLinks).where(and(
        eq(googleOperationalCalendarLinks.connectionId, review.connectionId),
        eq(googleOperationalCalendarLinks.calendarId, review.calendarId),
        eq(googleOperationalCalendarLinks.bookingId, bookingId),
        eq(googleOperationalCalendarLinks.packageKey, packageKey),
      )).limit(1);
      if (conflictingLink && conflictingLink.googleEventId !== review.googleEventId) {
        throw new Error("GOOGLE_OPERATIONAL_CALENDAR_BOOKING_ALREADY_LINKED");
      }
      if (review.linkId) {
        await tx.update(googleOperationalCalendarLinks).set(savedLink)
          .where(eq(googleOperationalCalendarLinks.id, review.linkId));
      } else {
        await tx.insert(googleOperationalCalendarLinks).values(savedLink).onConflictDoUpdate({
          target: [
            googleOperationalCalendarLinks.connectionId,
            googleOperationalCalendarLinks.calendarId,
            googleOperationalCalendarLinks.bookingId,
            googleOperationalCalendarLinks.packageKey,
          ],
          set: savedLink,
        });
      }
      await tx.update(googleOperationalCalendarReviews).set({
        bookingId,
        state: "accepted",
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(googleOperationalCalendarReviews.id, review.id));
      // This existing human review is the authority; reserved dates never prove public dates.
      const proofRevision = checksum(review.proposedChanges);
      const proof = [
        { field: "public_start", kind: actualDates ? "verified_event" : "unknown_import",
          value: actualDates ? actualDates.startsAt.toISOString().slice(0, 10) : publicDates.startsAt.toISOString(),
          semantics: actualDates ? "inclusive_date" : "instant" },
        { field: "public_end", kind: actualDates ? "verified_event" : "unknown_import",
          value: actualDates ? actualDates.endsAt.toISOString().slice(0, 10) : publicDates.endsAt.toISOString(),
          semantics: actualDates ? "inclusive_date" : "instant" },
        { field: "reservation_start", kind: "verified_reservation", value: google.startDate!, semantics: "inclusive_date" },
        { field: "reservation_end", kind: "verified_reservation", value: google.endDateExclusive!, semantics: "exclusive_date" },
      ];
      for (const endpoint of (created ? proof : [])) {
        await tx.execute(sql`
          INSERT INTO booking_date_evidence
            (booking_id, field, kind, value, semantics, revision, source_type, source_id, source_revision, actor)
          SELECT ${bookingId}::uuid, ${endpoint.field}, ${endpoint.kind}, ${endpoint.value},
            ${endpoint.semantics}, COALESCE(max(revision),0)+1,
            'google_calendar_review', ${review.id}, ${proofRevision}, ${input.reviewedBy}
          FROM booking_date_evidence WHERE booking_id=${bookingId}::uuid AND field=${endpoint.field}
        `);
      }
      return { state: "accepted", bookingId, created };
    });
  }

  private async findLegId(tx: any, managerToken: string | null | undefined) {
    if (!managerToken?.trim()) return null;
    const legs = await tx.select({ id: travelLegs.id, name: travelLegs.name }).from(travelLegs);
    return legs.find((leg: { name: string }) => normalize(leg.name) === normalize(managerToken))?.id ?? null;
  }
}

