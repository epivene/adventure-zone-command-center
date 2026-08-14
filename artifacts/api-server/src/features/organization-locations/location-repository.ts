import { and, asc, count, desc, eq, lt, or, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  activities,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizationLocations,
  organizations,
  travelLegs,
} from "@/db/schema";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

// ─── Value types ──────────────────────────────────────────────────────────────

export type LocationCoordinate = { lat: number; lng: number };

export type LocationFollowUpSummary = {
  id: string;
  kind: string;
  dueAt: Date;
};

export type LocationBookingSummary = {
  id: string;
  name: string;
  startsAt: Date | null;
  status: string;
};

export type LocationTravelLegSummary = {
  id: string;
  name: string;
  color: string;
};

export type OrgLocationSummary = {
  id: string;
  label: string;
  venueName: string | null;
  city: string | null;
  region: string | null;
  localStatus: string | null;
  coordinate: LocationCoordinate | null;
  nextFollowUp: LocationFollowUpSummary | null;
  nextBooking: LocationBookingSummary | null;
  travelLeg: LocationTravelLegSummary | null;
};

export type OrgLocationContactSummary = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
};

export type OrgLocationBookingDetail = {
  id: string;
  name: string;
  startsAt: Date | null;
  status: string;
  travelLeg: LocationTravelLegSummary | null;
};

export type OrgLocationFollowUpDetail = {
  id: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  contactId: string | null;
  bookingId: string | null;
};

export type OrgLocationActivityDetail = {
  id: string;
  kind: string;
  body: string;
  occurredAt: Date;
  contactId: string | null;
  bookingId: string | null;
};

export type OrgLocationDetail = OrgLocationSummary & {
  address1: string | null;
  address2: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  contacts: OrgLocationContactSummary[];
  bookings: OrgLocationBookingDetail[];
  followUps: OrgLocationFollowUpDetail[];
  activities: OrgLocationActivityDetail[];
  activitiesNextPage: string | null;
};

export type OrgLocationRollup = {
  locationCount: number;
  upcomingBookingCount: number;
  overdueFollowUpCount: number;
  travelLegs: LocationTravelLegSummary[];
  mostRecentActivityAt: Date | null;
};

export type CreateLocationInput = {
  label: string;
  venueName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  localStatus?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type UpdateLocationInput = Partial<Omit<CreateLocationInput, "label">> & {
  label?: string;
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Ensure a website string has a protocol prefix before storage. */
export function normalizeWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

// ─── Repository ───────────────────────────────────────────────────────────────

type DrizzleDatabase = typeof database;

export class DrizzleLocationRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  /** Compact summaries for all locations belonging to an organization. */
  async findByOrganization(organizationId: string): Promise<OrgLocationSummary[]> {
    const rows = await this.database.execute<{
      id: string;
      label: string;
      venueName: string | null;
      city: string | null;
      region: string | null;
      localStatus: string | null;
      lat: number | null;
      lng: number | null;
      nextFollowUpId: string | null;
      nextFollowUpKind: string | null;
      nextFollowUpDueAt: Date | null;
      nextBookingId: string | null;
      nextBookingName: string | null;
      nextBookingStartsAt: Date | null;
      nextBookingStatus: string | null;
      travelLegId: string | null;
      travelLegName: string | null;
      travelLegColor: string | null;
    }>(sql`
      SELECT
        loc.id,
        loc.label,
        loc.venue_name     AS "venueName",
        loc.city,
        loc.region,
        loc.local_status   AS "localStatus",
        loc.lat,
        loc.lng,
        next_fu.id         AS "nextFollowUpId",
        next_fu.kind       AS "nextFollowUpKind",
        next_fu.due_at     AS "nextFollowUpDueAt",
        next_bk.id         AS "nextBookingId",
        next_bk.name       AS "nextBookingName",
        next_bk.starts_at  AS "nextBookingStartsAt",
        next_bk.status::text AS "nextBookingStatus",
        next_leg.id        AS "travelLegId",
        next_leg.name      AS "travelLegName",
        next_leg.color     AS "travelLegColor"
      FROM ${organizationLocations} AS loc
      LEFT JOIN LATERAL (
        SELECT id, kind, due_at
        FROM ${followUps}
        WHERE organization_location_id = loc.id
          AND completed_at IS NULL
        ORDER BY due_at ASC, id ASC
        LIMIT 1
      ) AS next_fu ON true
      LEFT JOIN LATERAL (
        SELECT id, name, starts_at, status, travel_leg_id
        FROM ${bookings}
        WHERE organization_location_id = loc.id
          AND starts_at >= now()
          AND status NOT IN ('cancelled', 'declined', 'completed')
        ORDER BY starts_at ASC, id ASC
        LIMIT 1
      ) AS next_bk ON true
      LEFT JOIN ${travelLegs} AS next_leg ON next_leg.id = next_bk.travel_leg_id
      WHERE loc.organization_id = ${organizationId}
      ORDER BY loc.label ASC, loc.id ASC
    `);

    return rows.rows.map(rowToSummary);
  }

  /** Full location record with paginated activity/booking/follow-up/contact lists. */
  async findById(organizationId: string, locationId: string): Promise<OrgLocationDetail | null> {
    const [loc] = await this.database
      .select()
      .from(organizationLocations)
      .where(and(
        eq(organizationLocations.id, locationId),
        eq(organizationLocations.organizationId, organizationId),
      ))
      .limit(1);
    if (!loc) return null;

    const [locationContacts, locationBookings, locationFollowUps, locationActivities] =
      await Promise.all([
        // Contacts assigned to this location, with their org-level role/primary flag.
        this.database
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            role: organizationContacts.role,
            isPrimary: organizationContacts.isPrimary,
            phone: contacts.phone,
            email: contacts.email,
          })
          .from(contacts)
          .leftJoin(
            organizationContacts,
            and(
              eq(organizationContacts.contactId, contacts.id),
              eq(organizationContacts.organizationId, organizationId),
              eq(organizationContacts.active, true),
            ),
          )
          .where(eq(contacts.organizationLocationId, locationId))
          .orderBy(
            desc(organizationContacts.isPrimary),
            asc(contacts.lastName),
            asc(contacts.firstName),
            asc(contacts.id),
          ),
        // Bookings pinned to this location (only needed columns).
        this.database
          .select({
            id: bookings.id,
            name: bookings.name,
            startsAt: bookings.startsAt,
            status: bookings.status,
            travelLegId: travelLegs.id,
            travelLegName: travelLegs.name,
            travelLegColor: travelLegs.color,
          })
          .from(bookings)
          .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
          .where(eq(bookings.organizationLocationId, locationId))
          .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id)),
        // Follow-ups pinned to this location.
        this.database
          .select({
            id: followUps.id,
            kind: followUps.kind,
            dueAt: followUps.dueAt,
            completedAt: followUps.completedAt,
            contactId: followUps.contactId,
            bookingId: followUps.bookingId,
          })
          .from(followUps)
          .where(eq(followUps.organizationLocationId, locationId))
          .orderBy(asc(followUps.completedAt), asc(followUps.dueAt), asc(followUps.id)),
        // Activities pinned to this location — fetch 51 to detect a next page.
        this.database
          .select({
            id: activities.id,
            kind: activities.kind,
            body: activities.body,
            occurredAt: activities.timelineSortAt,
            contactId: activities.contactId,
            bookingId: activities.bookingId,
          })
          .from(activities)
          .where(eq(activities.organizationLocationId, locationId))
          .orderBy(desc(activities.timelineSortAt), desc(activities.id))
          .limit(51),
      ]);

    const hasMoreActivities = locationActivities.length > 50;
    const activityPage = locationActivities.slice(0, 50);
    const activitiesNextPage = hasMoreActivities
      ? (activityPage[activityPage.length - 1]?.id ?? null)
      : null;

    const coordinate: LocationCoordinate | null =
      loc.lat !== null && loc.lng !== null ? { lat: loc.lat, lng: loc.lng } : null;

    // Derive summary fields from the loaded data.
    const openFollowUps = locationFollowUps.filter((f) => f.completedAt === null);
    const nextFollowUp = openFollowUps[0] ?? null;
    const now = new Date();
    const inactiveStatuses = new Set(["cancelled", "declined", "completed"]);
    const upcomingBookings = locationBookings
      .filter((r) => r.startsAt && r.startsAt >= now && !inactiveStatuses.has(r.status))
      .sort((a, b) => Number(a.startsAt) - Number(b.startsAt));
    const nextBookingRecord = upcomingBookings[0];

    return {
      id: loc.id,
      label: loc.label,
      venueName: loc.venueName,
      city: loc.city,
      region: loc.region,
      localStatus: loc.localStatus,
      coordinate,
      address1: loc.address1,
      address2: loc.address2,
      postalCode: loc.postalCode,
      website: loc.website,
      phone: loc.phone,
      email: loc.email,
      nextFollowUp: nextFollowUp
        ? { id: nextFollowUp.id, kind: nextFollowUp.kind, dueAt: nextFollowUp.dueAt }
        : null,
      nextBooking: nextBookingRecord
        ? {
            id: nextBookingRecord.id,
            name: nextBookingRecord.name,
            startsAt: nextBookingRecord.startsAt,
            status: nextBookingRecord.status,
          }
        : null,
      travelLeg: nextBookingRecord?.travelLegId && nextBookingRecord.travelLegName && nextBookingRecord.travelLegColor
        ? {
            id: nextBookingRecord.travelLegId,
            name: nextBookingRecord.travelLegName,
            color: nextBookingRecord.travelLegColor,
          }
        : null,
      contacts: locationContacts.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        role: c.role ?? null,
        isPrimary: c.isPrimary ?? false,
        phone: c.phone,
        email: c.email,
      })),
      bookings: locationBookings.map((r) => ({
        id: r.id,
        name: r.name,
        startsAt: r.startsAt,
        status: r.status,
        travelLeg: r.travelLegId && r.travelLegName && r.travelLegColor
          ? { id: r.travelLegId, name: r.travelLegName, color: r.travelLegColor }
          : null,
      })),
      followUps: locationFollowUps,
      activities: activityPage,
      activitiesNextPage,
    };
  }

  /** Create a new location for an organization. */
  async create(
    organizationId: string,
    input: CreateLocationInput,
    now: Date,
  ): Promise<{ id: string }> {
    const [org] = await this.database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) throw new Error("ORGANIZATION_NOT_FOUND");

    // Reject partially-specified coordinates — both must be present or both absent.
    if ((input.lat == null) !== (input.lng == null)) {
      throw new Error("INCOMPLETE_COORDINATE");
    }

    const rawPhone = input.phone?.trim() ?? null;
    const [location] = await this.database
      .insert(organizationLocations)
      .values({
        organizationId,
        label: input.label.trim(),
        venueName: input.venueName?.trim() ?? null,
        address1: input.address1?.trim() ?? null,
        address2: input.address2?.trim() ?? null,
        city: input.city?.trim() ?? null,
        region: input.region?.trim() ?? null,
        postalCode: input.postalCode?.trim() ?? null,
        website: normalizeWebsite(input.website),
        phone: rawPhone,
        normalizedPhone: rawPhone ? normalizeNorthAmericanPhone(rawPhone) : null,
        email: input.email?.trim()?.toLowerCase() || null,
        localStatus: input.localStatus?.trim() ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: organizationLocations.id });
    if (!location) throw new Error("LOCATION_CREATE_FAILED");
    return { id: location.id };
  }

  /** Patch editable fields on a location. Returns false if not found. */
  async update(
    organizationId: string,
    locationId: string,
    input: UpdateLocationInput,
    now: Date,
  ): Promise<boolean> {
    // Reject partially-specified coordinates — both must be present or both absent.
    if ("lat" in input && "lng" in input) {
      if ((input.lat == null) !== (input.lng == null)) {
        throw new Error("INCOMPLETE_COORDINATE");
      }
    } else if ("lat" in input || "lng" in input) {
      throw new Error("INCOMPLETE_COORDINATE");
    }

    // Build a partial update object with only the supplied keys.
    const set: Record<string, unknown> = { updatedAt: now };
    if (input.label !== undefined) set.label = input.label.trim();
    if ("venueName" in input) set.venueName = input.venueName?.trim() ?? null;
    if ("address1" in input) set.address1 = input.address1?.trim() ?? null;
    if ("address2" in input) set.address2 = input.address2?.trim() ?? null;
    if ("city" in input) set.city = input.city?.trim() ?? null;
    if ("region" in input) set.region = input.region?.trim() ?? null;
    if ("postalCode" in input) set.postalCode = input.postalCode?.trim() ?? null;
    if ("website" in input) set.website = normalizeWebsite(input.website);
    if ("phone" in input) {
      const rawPhone = input.phone?.trim() ?? null;
      set.phone = rawPhone;
      set.normalizedPhone = rawPhone ? normalizeNorthAmericanPhone(rawPhone) : null;
    }
    if ("email" in input) set.email = input.email?.trim()?.toLowerCase() || null;
    if ("localStatus" in input) set.localStatus = input.localStatus?.trim() ?? null;
    if ("lat" in input) set.lat = input.lat ?? null;
    if ("lng" in input) set.lng = input.lng ?? null;

    const [updated] = await this.database
      .update(organizationLocations)
      .set(set as Partial<typeof organizationLocations.$inferInsert>)
      .where(and(
        eq(organizationLocations.id, locationId),
        eq(organizationLocations.organizationId, organizationId),
      ))
      .returning({ id: organizationLocations.id });
    return Boolean(updated);
  }

  /**
   * Remove a location.
   *
   * Returns:
   *  - "ok"            — deleted successfully
   *  - "has_dependents" — contacts, activities, bookings, or follow-ups are
   *                       pinned to this location; cannot delete
   *  - "not_found"     — no matching location for this org
   */
  async remove(
    organizationId: string,
    locationId: string,
  ): Promise<"ok" | "has_dependents" | "not_found"> {
    const [loc] = await this.database
      .select({ id: organizationLocations.id })
      .from(organizationLocations)
      .where(and(
        eq(organizationLocations.id, locationId),
        eq(organizationLocations.organizationId, organizationId),
      ))
      .limit(1);
    if (!loc) return "not_found";

    const [[contactCount], [activityCount], [bookingCount], [followUpCount]] =
      await Promise.all([
        this.database
          .select({ value: count() })
          .from(contacts)
          .where(eq(contacts.organizationLocationId, locationId)),
        this.database
          .select({ value: count() })
          .from(activities)
          .where(eq(activities.organizationLocationId, locationId)),
        this.database
          .select({ value: count() })
          .from(bookings)
          .where(eq(bookings.organizationLocationId, locationId)),
        this.database
          .select({ value: count() })
          .from(followUps)
          .where(eq(followUps.organizationLocationId, locationId)),
      ]);

    const hasDependents =
      (contactCount?.value ?? 0) > 0 ||
      (activityCount?.value ?? 0) > 0 ||
      (bookingCount?.value ?? 0) > 0 ||
      (followUpCount?.value ?? 0) > 0;

    if (hasDependents) return "has_dependents";

    await this.database
      .delete(organizationLocations)
      .where(and(
        eq(organizationLocations.id, locationId),
        eq(organizationLocations.organizationId, organizationId),
      ));
    return "ok";
  }

  /**
   * Fetch a cursor-keyed page of activities for a single location.
   * Returns up to 50 activities ordered by (timelineSortAt DESC, id DESC).
   * Pass `cursor` (an activity id) to start after the previous page's last item.
   */
  /**
   * Simple UUID-v4 shape check so a malformed cursor doesn't cause a Postgres
   * "invalid input syntax for type uuid" error before we can handle it cleanly.
   */
  private static isValidUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  async findLocationActivities(
    organizationId: string,
    locationId: string,
    cursor?: string,
  ): Promise<{ activities: OrgLocationActivityDetail[]; activitiesNextPage: string | null }> {
    // Reject a malformed cursor immediately rather than letting Postgres error.
    if (cursor !== undefined && !DrizzleLocationRepository.isValidUuid(cursor)) {
      return { activities: [], activitiesNextPage: null };
    }

    // Verify the location belongs to this org.
    const [loc] = await this.database
      .select({ id: organizationLocations.id })
      .from(organizationLocations)
      .where(
        and(
          eq(organizationLocations.id, locationId),
          eq(organizationLocations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!loc) return { activities: [], activitiesNextPage: null };

    // Resolve cursor to a (timelineSortAt, id) boundary.
    let cursorSortAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const [row] = await this.database
        .select({ sortAt: activities.timelineSortAt, id: activities.id })
        .from(activities)
        .where(
          and(
            eq(activities.id, cursor),
            eq(activities.organizationLocationId, locationId),
          ),
        )
        .limit(1);
      // Unknown / deleted cursor — return empty rather than duplicating page 1.
      if (!row) return { activities: [], activitiesNextPage: null };
      cursorSortAt = row.sortAt;
      cursorId = row.id;
    }

    // Keyset condition: rows that come after the cursor in descending order.
    const cursorCondition =
      cursorSortAt && cursorId
        ? or(
            lt(activities.timelineSortAt, cursorSortAt),
            and(
              eq(activities.timelineSortAt, cursorSortAt),
              lt(activities.id, cursorId),
            ),
          )
        : undefined;

    const rows = await this.database
      .select({
        id: activities.id,
        kind: activities.kind,
        body: activities.body,
        occurredAt: activities.timelineSortAt,
        contactId: activities.contactId,
        bookingId: activities.bookingId,
      })
      .from(activities)
      .where(
        and(eq(activities.organizationLocationId, locationId), cursorCondition),
      )
      .orderBy(desc(activities.timelineSortAt), desc(activities.id))
      .limit(51);

    const hasMore = rows.length > 50;
    const page = rows.slice(0, 50);
    const activitiesNextPage = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      activities: page.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        occurredAt: r.occurredAt,
        contactId: r.contactId,
        bookingId: r.bookingId,
      })),
      activitiesNextPage,
    };
  }

  /**
   * Aggregate counts/dates for an organization's location profile rollup.
   * Counts bookings, follow-ups, and activities at the org level (not
   * restricted to location-pinned records).
   */
  async rollupForOrganization(organizationId: string): Promise<OrgLocationRollup> {
    const [countRows, travelLegRows] = await Promise.all([
      this.database.execute<{
        locationCount: number;
        upcomingBookingCount: number;
        overdueFollowUpCount: number;
        mostRecentActivityAt: Date | null;
      }>(sql`
        SELECT
          (
            SELECT count(*)::int
            FROM ${organizationLocations}
            WHERE organization_id = ${organizationId}
          ) AS "locationCount",
          (
            SELECT count(*)::int
            FROM ${bookings}
            WHERE organization_id = ${organizationId}
              AND starts_at >= now()
              AND status NOT IN ('cancelled', 'declined', 'completed')
          ) AS "upcomingBookingCount",
          (
            SELECT count(*)::int
            FROM ${followUps}
            WHERE organization_id = ${organizationId}
              AND completed_at IS NULL
              AND due_at < now()
          ) AS "overdueFollowUpCount",
          (
            SELECT max(timeline_sort_at)
            FROM ${activities}
            WHERE organization_id = ${organizationId}
          ) AS "mostRecentActivityAt"
      `),
      this.database
        .select({
          id: travelLegs.id,
          name: travelLegs.name,
          color: travelLegs.color,
        })
        .from(travelLegs)
        .innerJoin(bookings, eq(bookings.travelLegId, travelLegs.id))
        .where(eq(bookings.organizationId, organizationId))
        .groupBy(travelLegs.id, travelLegs.name, travelLegs.color)
        .orderBy(asc(travelLegs.name), asc(travelLegs.id)),
    ]);

    const row = countRows.rows[0];
    return {
      locationCount: Number(row?.locationCount ?? 0),
      upcomingBookingCount: Number(row?.upcomingBookingCount ?? 0),
      overdueFollowUpCount: Number(row?.overdueFollowUpCount ?? 0),
      travelLegs: travelLegRows,
      mostRecentActivityAt: row?.mostRecentActivityAt
        ? new Date(row.mostRecentActivityAt)
        : null,
    };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToSummary(row: {
  id: string;
  label: string;
  venueName: string | null;
  city: string | null;
  region: string | null;
  localStatus: string | null;
  lat: number | null;
  lng: number | null;
  nextFollowUpId: string | null;
  nextFollowUpKind: string | null;
  nextFollowUpDueAt: Date | null;
  nextBookingId: string | null;
  nextBookingName: string | null;
  nextBookingStartsAt: Date | null;
  nextBookingStatus: string | null;
  travelLegId: string | null;
  travelLegName: string | null;
  travelLegColor: string | null;
}): OrgLocationSummary {
  return {
    id: row.id,
    label: row.label,
    venueName: row.venueName,
    city: row.city,
    region: row.region,
    localStatus: row.localStatus,
    coordinate:
      row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    nextFollowUp:
      row.nextFollowUpId && row.nextFollowUpKind && row.nextFollowUpDueAt
        ? {
            id: row.nextFollowUpId,
            kind: row.nextFollowUpKind,
            dueAt: new Date(row.nextFollowUpDueAt),
          }
        : null,
    nextBooking:
      row.nextBookingId && row.nextBookingName && row.nextBookingStatus
        ? {
            id: row.nextBookingId,
            name: row.nextBookingName,
            startsAt: row.nextBookingStartsAt ? new Date(row.nextBookingStartsAt) : null,
            status: row.nextBookingStatus,
          }
        : null,
    travelLeg:
      row.travelLegId && row.travelLegName && row.travelLegColor
        ? { id: row.travelLegId, name: row.travelLegName, color: row.travelLegColor }
        : null,
  };
}
