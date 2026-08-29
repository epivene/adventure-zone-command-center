import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOperationalWindows,
  bookingPackageSelections,
  bookings,
  organizations,
  packageTemplates,
  travelLegs,
  type OperationalCalendarPackageKey,
} from "@/db/schema";
import type { OperationalCalendarClient, OperationalCalendarEvent } from "./operational-calendar-client";
import { OperationalCalendarLinkRepository, type OperationalCalendarLink } from "./operational-calendar-link-repository";
import { parseDavidOperationalCalendarEvent } from "./david-calendar-parser";
import {
  matchOperationalCalendarEvent,
  parseOperationalEventDateText,
  type OperationalCalendarMatchCandidate,
} from "./operational-calendar-matcher";

type DrizzleDatabase = typeof database;

export type OperationalCalendarImportRowResult = {
  googleEventId: string;
  title: string;
  outcome: "matched" | "created" | "review" | "already_linked";
  bookingId: string | null;
  bookingName: string | null;
  reason: string | null;
};

function startOfUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_DATE_INVALID");
  return date;
}

function stateStatus(state: ReturnType<typeof parseDavidOperationalCalendarEvent>["calendarState"]) {
  if (state === "confirmed") return "confirmed" as const;
  if (state === "cancelled") return "cancelled" as const;
  if (state === "action_required") return "researching" as const;
  return "possible" as const;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function checksum(event: OperationalCalendarEvent) {
  return createHash("sha256").update(JSON.stringify({
    summary: event.summary,
    description: event.description,
    startDate: event.startDate,
    endDateExclusive: event.endDateExclusive,
    etag: event.etag,
  }), "utf8").digest("hex");
}

function packageCodeCandidates(key: OperationalCalendarPackageKey) {
  if (key === "zone") return ["adventure_zone", "mini_zone"];
  if (key === "pirates") return ["pirates_rebellion", "pirate_rebellion"];
  return ["weekend_warriors", "warriors_playground"];
}

function parseAddressLine(addressText: string | null) {
  if (!addressText) return null;
  const first = addressText.split(/\n/).map((part) => part.trim()).find(Boolean);
  return first || null;
}

export class OperationalCalendarImportService {
  private readonly links: OperationalCalendarLinkRepository;

  constructor(
    private readonly db: DrizzleDatabase,
    private readonly clientProvider: () => Promise<{
      connectionId: string;
      calendarId: string;
      client: OperationalCalendarClient;
    } | null>,
    links?: OperationalCalendarLinkRepository,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.links = links ?? new OperationalCalendarLinkRepository(db);
  }

  async importWindow(input: { from: Date; to: Date }): Promise<{
    matched: number;
    updated: number;
    created: number;
    review: number;
    rows: number;
    results: OperationalCalendarImportRowResult[];
  }> {
    const connection = await this.clientProvider();
    if (!connection) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_NOT_CONNECTED");
    if (!Number.isFinite(input.from.getTime()) || !Number.isFinite(input.to.getTime()) || input.to <= input.from) {
      throw new Error("GOOGLE_OPERATIONAL_CALENDAR_IMPORT_WINDOW_INVALID");
    }

    const events: OperationalCalendarEvent[] = [];
    let pageToken: string | null = null;
    do {
      const page = await connection.client.listEvents({
        calendarId: connection.calendarId,
        timeMin: input.from.toISOString(),
        timeMax: input.to.toISOString(),
        pageToken,
      });
      events.push(...page.events);
      pageToken = page.nextPageToken;
    } while (pageToken);

    let matched = 0;
    let updated = 0;
    let created = 0;
    let review = 0;
    const results: OperationalCalendarImportRowResult[] = [];

    for (const event of events) {
      const title = event.summary?.trim() || "Untitled Google calendar event";
      const existingLink = await this.links.findByGoogleEvent({
        connectionId: connection.connectionId,
        calendarId: connection.calendarId,
        googleEventId: event.id,
      });
      if (existingLink) {
        const parsed = parseDavidOperationalCalendarEvent({ summary: event.summary, description: event.description });
        const reservedStart = startOfUtcDay(event.startDate);
        const reservedEnd = startOfUtcDay(event.endDateExclusive);
        const actualDates = parseOperationalEventDateText(parsed.actualEventDateText, reservedStart.getUTCFullYear());
        await this.refreshExistingLink({
          connectionId: connection.connectionId,
          calendarId: connection.calendarId,
          existingLink,
          event,
          parsed,
          actualDates,
          reservedStart,
          reservedEnd,
        });
        updated += 1;
        results.push({
          googleEventId: event.id,
          title,
          outcome: "already_linked",
          bookingId: existingLink.bookingId,
          bookingName: await this.bookingName(existingLink.bookingId),
          reason: null,
        });
        continue;
      }

      const parsed = parseDavidOperationalCalendarEvent({ summary: event.summary, description: event.description });
      if (!parsed.eventName.trim() || parsed.packageKey === "unknown") {
        const reason = "Calendar row needs manual matching";
        await this.links.createReview({
          connectionId: connection.connectionId,
          calendarId: connection.calendarId,
          googleEventId: event.id,
          reason,
          proposedChanges: { parsed, google: event },
        });
        review += 1;
        results.push({ googleEventId: event.id, title, outcome: "review", bookingId: null, bookingName: null, reason });
        continue;
      }

      const reservedStart = startOfUtcDay(event.startDate);
      const reservedEnd = startOfUtcDay(event.endDateExclusive);
      const actualDates = parseOperationalEventDateText(parsed.actualEventDateText, reservedStart.getUTCFullYear());
      const match = matchOperationalCalendarEvent({
        eventName: parsed.eventName,
        city: parsed.city,
        region: parsed.region,
        actualStartsAt: actualDates?.startsAt ?? null,
        actualEndsAt: actualDates?.endsAt ?? null,
        managerToken: parsed.managerToken,
        candidates: await this.loadCandidates(),
      });

      if (match.kind === "review") {
        await this.links.createReview({
          connectionId: connection.connectionId,
          calendarId: connection.calendarId,
          googleEventId: event.id,
          reason: match.reason,
          proposedChanges: { parsed, candidateBookingIds: match.candidateBookingIds, google: event },
        });
        review += 1;
        results.push({ googleEventId: event.id, title, outcome: "review", bookingId: null, bookingName: null, reason: match.reason });
        continue;
      }

      let bookingId: string;
      let outcome: OperationalCalendarImportRowResult["outcome"];
      if (match.kind === "matched") {
        bookingId = match.bookingId;
        outcome = "matched";
        matched += 1;
        await this.updateMatchedBooking({ bookingId, parsed, actualDates, reservedStart, reservedEnd });
        updated += 1;
      } else {
        if (!actualDates || !parsed.city || !parsed.region) {
          const reason = "New calendar event is missing reliable public dates or location";
          await this.links.createReview({
            connectionId: connection.connectionId,
            calendarId: connection.calendarId,
            googleEventId: event.id,
            reason,
            proposedChanges: { parsed, google: event },
          });
          review += 1;
          results.push({ googleEventId: event.id, title, outcome: "review", bookingId: null, bookingName: null, reason });
          continue;
        }
        bookingId = await this.createProfileAndBooking({ parsed, actualDates, reservedStart, reservedEnd });
        outcome = "created";
        created += 1;
      }

      await this.ensurePackage(bookingId, parsed.packageKey);
      await this.links.saveSuccessfulSync({
        connectionId: connection.connectionId,
        calendarId: connection.calendarId,
        googleEventId: event.id,
        bookingId,
        packageKey: parsed.packageKey,
        etag: event.etag,
        sourceChecksum: checksum(event),
        lastAppSnapshot: {
          imported: true,
          summary: event.summary,
          description: event.description,
          startDate: event.startDate,
          endDateExclusive: event.endDateExclusive,
        },
        reservedStartsAt: reservedStart,
        reservedEndsAt: reservedEnd,
        syncedAt: this.now(),
      });
      results.push({
        googleEventId: event.id,
        title,
        outcome,
        bookingId,
        bookingName: await this.bookingName(bookingId),
        reason: null,
      });
    }

    return { matched, updated, created, review, rows: events.length, results };
  }

  private async bookingName(bookingId: string) {
    const [booking] = await this.db.select({ name: bookings.name }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    return booking?.name ?? null;
  }

  private async refreshExistingLink(input: {
    connectionId: string;
    calendarId: string;
    existingLink: OperationalCalendarLink;
    event: OperationalCalendarEvent;
    parsed: ReturnType<typeof parseDavidOperationalCalendarEvent>;
    actualDates: { startsAt: Date; endsAt: Date } | null;
    reservedStart: Date;
    reservedEnd: Date;
  }) {
    await this.updateMatchedBooking({
      bookingId: input.existingLink.bookingId,
      parsed: input.parsed,
      actualDates: input.actualDates,
      reservedStart: input.reservedStart,
      reservedEnd: input.reservedEnd,
    });
    await this.ensurePackage(input.existingLink.bookingId, input.existingLink.packageKey);
    await this.links.saveSuccessfulSync({
      connectionId: input.connectionId,
      calendarId: input.calendarId,
      googleEventId: input.event.id,
      bookingId: input.existingLink.bookingId,
      packageKey: input.existingLink.packageKey,
      etag: input.event.etag,
      sourceChecksum: checksum(input.event),
      lastAppSnapshot: {
        imported: true,
        summary: input.event.summary,
        description: input.event.description,
        startDate: input.event.startDate,
        endDateExclusive: input.event.endDateExclusive,
      },
      reservedStartsAt: input.reservedStart,
      reservedEndsAt: input.reservedEnd,
      syncedAt: this.now(),
    });
  }

  private async loadCandidates(): Promise<OperationalCalendarMatchCandidate[]> {
    const rows = await this.db
      .select({ booking: bookings, legName: travelLegs.name })
      .from(bookings)
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .orderBy(asc(bookings.startsAt), asc(bookings.name));
    return rows.map(({ booking, legName }) => ({
      bookingId: booking.id,
      organizationId: booking.organizationId,
      name: booking.name,
      city: booking.city,
      region: booking.region,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      travelLegName: legName,
    }));
  }

  private async findLegId(managerToken: string | null) {
    if (!managerToken) return null;
    const legs = await this.db.select().from(travelLegs);
    return legs.find((leg) => normalized(leg.name) === normalized(managerToken))?.id ?? null;
  }

  private async updateMatchedBooking(input: {
    bookingId: string;
    parsed: ReturnType<typeof parseDavidOperationalCalendarEvent>;
    actualDates: { startsAt: Date; endsAt: Date } | null;
    reservedStart: Date;
    reservedEnd: Date;
  }) {
    const legId = await this.findLegId(input.parsed.managerToken);
    const [existing] = await this.db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
    if (!existing) return;
    await this.db.update(bookings).set({
      status: stateStatus(input.parsed.calendarState),
      startsAt: input.actualDates?.startsAt ?? existing.startsAt,
      endsAt: input.actualDates?.endsAt ?? existing.endsAt,
      travelLegId: legId ?? existing.travelLegId,
      city: input.parsed.city ?? existing.city,
      region: input.parsed.region ?? existing.region,
      address1: parseAddressLine(input.parsed.addressText) ?? existing.address1,
      notes: input.parsed.originalDescription?.trim() || existing.notes,
      updatedAt: this.now(),
    }).where(eq(bookings.id, input.bookingId));
    await this.saveWindow(input.bookingId, input.reservedStart, input.reservedEnd);
  }

  private async createProfileAndBooking(input: {
    parsed: ReturnType<typeof parseDavidOperationalCalendarEvent>;
    actualDates: { startsAt: Date; endsAt: Date };
    reservedStart: Date;
    reservedEnd: Date;
  }) {
    const legId = await this.findLegId(input.parsed.managerToken);
    return this.db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({
        name: input.parsed.eventName,
        city: input.parsed.city,
        region: input.parsed.region,
        address1: parseAddressLine(input.parsed.addressText),
        placeType: "festival_event",
        createdAt: this.now(),
        updatedAt: this.now(),
      }).returning({ id: organizations.id });
      if (!organization) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_PROFILE_CREATE_FAILED");
      const [booking] = await tx.insert(bookings).values({
        organizationId: organization.id,
        name: input.parsed.eventName,
        city: input.parsed.city!,
        region: input.parsed.region!,
        address1: parseAddressLine(input.parsed.addressText),
        startsAt: input.actualDates.startsAt,
        endsAt: input.actualDates.endsAt,
        status: stateStatus(input.parsed.calendarState),
        probability: (input.parsed.calendarState === "confirmed" ? "definite" : "possible") as any,
        travelLegId: legId,
        notes: input.parsed.originalDescription?.trim() || null,
        createdAt: this.now(),
        updatedAt: this.now(),
      }).returning({ id: bookings.id });
      if (!booking) throw new Error("GOOGLE_OPERATIONAL_CALENDAR_BOOKING_CREATE_FAILED");
      await tx.insert(bookingOperationalWindows).values({
        bookingId: booking.id,
        startsAt: input.reservedStart,
        endsAt: input.reservedEnd,
        source: "google_calendar",
      });
      return booking.id;
    });
  }

  private async saveWindow(bookingId: string, startsAt: Date, endsAt: Date) {
    await this.db.insert(bookingOperationalWindows).values({
      bookingId, startsAt, endsAt, source: "google_calendar",
    }).onConflictDoUpdate({
      target: bookingOperationalWindows.bookingId,
      set: { startsAt, endsAt, source: "google_calendar", updatedAt: this.now() },
    });
  }

  private async ensurePackage(bookingId: string, key: OperationalCalendarPackageKey) {
    const templates = await this.db.select().from(packageTemplates);
    const candidates = packageCodeCandidates(key);
    const template = templates.find((item) => candidates.includes(item.code));
    if (!template) return;
    await this.db.insert(bookingPackageSelections).values({
      bookingId, packageTemplateId: template.id,
    }).onConflictDoNothing();
  }
}
