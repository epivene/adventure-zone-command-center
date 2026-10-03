import type { ResolvedDates } from "../booking-date-repair/date-evidence";
import { operationsDateKey } from "../bookings/booking-leg-operations-history";
import { asc, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import { bookingOperationalWindows, bookings, eventDateFacts, organizations } from "@/db/schema";
import { resolveEffectiveEventDate } from "./effective-event-date";

export type CoverageStatus =
  | "booked"
  | "confirmed"
  | "expected"
  | "missing"
  | "stale"
  | "needs_review";

export type CoverageSummary = Record<CoverageStatus, number>;

export type CoverageOrganization = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

export type CoverageBooking = {
  id: string;
  organizationId: string;
  startsOn: string | null;
  endsOn: string | null;
  status: string | null;
  probability?: string | null;
  dateProvenance?: ResolvedDates;
};

export type CoverageFact = {
  id: string;
  organizationId: string;
  startsOn: string;
  endsOn: string | null;
  status: "confirmed" | "expected" | "needs_review";
  active: boolean;
  researchedAt: Date;
  verifiedAt: Date | null;
};

export interface CoverageDataSource {
  loadOrganizations(): Promise<CoverageOrganization[]>;
  loadBookings(): Promise<CoverageBooking[]>;
  loadFacts(): Promise<CoverageFact[]>;
}

export type CoverageRecord = {
  organizationId: string;
  name: string;
  city: string | null;
  region: string | null;
  status: CoverageStatus;
  effectiveDate: {
    startsOn: string;
    endsOn: string | null;
    displayStatus: "booked" | "confirmed" | "expected";
    sourceId: string;
  } | null;
  lastKnownEventDate: string | null;
  lastResearchedAt: Date | null;
};

export type CoverageListQuery = {
  today: string;
  page: number;
  pageSize: number;
  search: string;
  status: CoverageStatus | "all";
};

export type CoverageListPage = {
  records: CoverageRecord[];
  summary: CoverageSummary;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function latestDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null)
    .toSorted((left, right) => right.localeCompare(left))[0] ?? null;
}

export class DrizzleCoverageDataSource implements CoverageDataSource {
  constructor(private readonly database: PgDatabase<any, any, any>) {}

  loadOrganizations(): Promise<CoverageOrganization[]> {
    return this.database.select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      region: organizations.region,
    }).from(organizations)
      .where(isNull(organizations.consolidatedIntoId))
      .orderBy(asc(organizations.name), asc(organizations.id));
  }

  async loadBookings(): Promise<CoverageBooking[]> {
    const rows = await this.database.select({
      id: bookings.id,
      organizationId: bookings.organizationId,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      probability: bookings.probability,
      dateProvenance: sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})`,
    }).from(bookings).leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId));
    return rows.flatMap((row) => row.organizationId ? [{
      id: row.id,
      organizationId: row.organizationId,
      startsOn: row.dateProvenance.publicWindow ? operationsDateKey(row.dateProvenance.publicWindow.start) : null,
      endsOn: row.dateProvenance.publicWindow ? operationsDateKey(new Date(new Date(row.dateProvenance.publicWindow.end).getTime() - (row.dateProvenance.publicEndExclusive ? 1 : 0))) : null,
      status: row.status,
      probability:row.probability,
      dateProvenance:row.dateProvenance,
    }] : []);
  }

  loadFacts(): Promise<CoverageFact[]> {
    return this.database.select({
      id: eventDateFacts.id,
      organizationId: eventDateFacts.organizationId,
      startsOn: eventDateFacts.startsOn,
      endsOn: eventDateFacts.endsOn,
      status: eventDateFacts.status,
      active: eventDateFacts.active,
      researchedAt: eventDateFacts.researchedAt,
      verifiedAt: eventDateFacts.verifiedAt,
    }).from(eventDateFacts);
  }
}

function emptySummary(): CoverageSummary {
  return { booked: 0, confirmed: 0, expected: 0, missing: 0, stale: 0, needs_review: 0 };
}

export class CoverageRepository {
  constructor(private readonly source: CoverageDataSource) {}

  static fromDatabase(database: PgDatabase<any, any, any>): CoverageRepository {
    return new CoverageRepository(new DrizzleCoverageDataSource(database));
  }

  async list(query: CoverageListQuery): Promise<CoverageListPage> {
    const [organizations, bookings, facts] = await Promise.all([
      this.source.loadOrganizations(),
      this.source.loadBookings(),
      this.source.loadFacts(),
    ]);
    const bookingsByOrganization = Map.groupBy(bookings, (row) => row.organizationId);
    const factsByOrganization = Map.groupBy(facts, (row) => row.organizationId);
    const search = query.search.trim().toLocaleLowerCase();

    const classified = organizations.map((organization): CoverageRecord => {
      const organizationBookings = bookingsByOrganization.get(organization.id) ?? [];
      const organizationFacts = factsByOrganization.get(organization.id) ?? [];
      const effectiveDate = resolveEffectiveEventDate({
        today: query.today,
        bookings: organizationBookings,
        facts: organizationFacts,
      });
      const hasReview = organizationFacts.some((fact) => fact.status === "needs_review") || organizationBookings.some(b=>b.dateProvenance?.evidenceState==="needs_review");
      const lastKnownEventDate = latestDate([
        ...organizationBookings.map((booking) => booking.startsOn),
        ...organizationFacts.map((fact) => fact.startsOn),
      ]);
      const status: CoverageStatus = effectiveDate?.displayStatus
        ?? (hasReview ? "needs_review" : lastKnownEventDate ? "stale" : "missing");
      const lastResearchedAt = organizationFacts
        .map((fact) => fact.verifiedAt ?? fact.researchedAt)
        .toSorted((left, right) => right.getTime() - left.getTime())[0] ?? null;
      return {
        organizationId: organization.id,
        name: organization.name,
        city: organization.city,
        region: organization.region,
        status,
        effectiveDate,
        lastKnownEventDate,
        lastResearchedAt,
      };
    }).filter((row) => !search || [row.name, row.city, row.region]
      .some((value) => value?.toLocaleLowerCase().includes(search)));

    const summary = classified.reduce((counts, row) => {
      counts[row.status] += 1;
      return counts;
    }, emptySummary());
    const filtered = query.status === "all"
      ? classified
      : classified.filter((row) => row.status === query.status);
    const pageSize = Math.max(1, query.pageSize);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(1, query.page), pageCount);
    const offset = (page - 1) * pageSize;
    return {
      records: filtered.slice(offset, offset + pageSize),
      summary,
      total: filtered.length,
      page,
      pageSize,
      pageCount,
    };
  }
}
