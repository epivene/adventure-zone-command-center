import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import type { AssistantLeadMatch, LeadDiscoveryCriteria } from "./lead-scout-types";

type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
};

type BookingRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string | null;
  createdAt: Date;
};

type OrganizationGroup = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  bookings: BookingRow[];
};

export interface LeadScoutCrmSearch {
  search(criteria: LeadDiscoveryCriteria, limit?: number): Promise<AssistantLeadMatch[]>;
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeBookingEndDate(value: Date | null) {
  if (!value) return null;
  // ACT/open-ended imports can use a far-future sentinel instead of a real
  // event end date. Keep Lead Scout consistent with the Calendar behavior.
  return value.getUTCFullYear() >= 2100 ? null : value;
}

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function requestedBounds(criteria: LeadDiscoveryCriteria) {
  if (!criteria.dateFrom || !criteria.dateThrough) return null;
  const from = new Date(`${criteria.dateFrom}T00:00:00.000Z`);
  const through = new Date(`${criteria.dateThrough}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(through.getTime())) return null;
  return { from, through };
}

function overlapsRequestedWindow(booking: BookingRow, criteria: LeadDiscoveryCriteria) {
  const bounds = requestedBounds(criteria);
  if (!bounds || !booking.startsAt) return false;
  const end = booking.endsAt ?? booking.startsAt;
  return booking.startsAt <= bounds.through && end >= bounds.from;
}

function occursInRequestedMonth(booking: BookingRow, criteria: LeadDiscoveryCriteria) {
  if (!criteria.month || !booking.startsAt) return false;
  if (criteria.year && booking.startsAt.getUTCFullYear() >= criteria.year) return false;
  const startMonth = booking.startsAt.getUTCMonth() + 1;
  const endMonth = (booking.endsAt ?? booking.startsAt).getUTCMonth() + 1;
  return criteria.month >= Math.min(startMonth, endMonth) && criteria.month <= Math.max(startMonth, endMonth);
}

function monthLabel(month: number | null) {
  if (!month) return "requested seasonal window";
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

function keywordMatch(group: OrganizationGroup, criteria: LeadDiscoveryCriteria) {
  if (!criteria.eventKeywords.length) return false;
  const haystack = [group.name, ...group.bookings.map((booking) => booking.name)].join(" ").toLowerCase();
  return criteria.eventKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function geographyReason(criteria: LeadDiscoveryCriteria) {
  if (criteria.geoMode === "corridor") return "On requested corridor";
  if (criteria.geoMode === "route") return "Matches requested route/leg area";
  return "In requested region";
}

function rankGroup(group: OrganizationGroup, criteria: LeadDiscoveryCriteria): AssistantLeadMatch {
  const ordered = [...group.bookings].sort((left, right) => {
    const leftTime = left.startsAt?.getTime() ?? left.createdAt.getTime();
    const rightTime = right.startsAt?.getTime() ?? right.createdAt.getTime();
    return rightTime - leftTime;
  });
  const latest = ordered[0] ?? null;
  const confirmed = ordered.find((booking) => overlapsRequestedWindow(booking, criteria)) ?? null;
  const recurring = confirmed ? [] : ordered.filter((booking) => occursInRequestedMonth(booking, criteria));
  const dateConfidence: AssistantLeadMatch["dateConfidence"] = confirmed
    ? "confirmed"
    : recurring.length
      ? "likely_recurring"
      : "unknown";

  const reasons: string[] = [geographyReason(criteria)];
  if (confirmed) reasons.unshift(`Confirmed ${monthLabel(criteria.month)} date`);
  if (recurring.length) reasons.unshift(`Usually occurs in ${monthLabel(criteria.month)}`);
  if (ordered.length) reasons.push("Past Adventure Zone customer");
  if (keywordMatch(group, criteria)) reasons.push("Event format matches requested type");

  let fitScore = dateConfidence === "confirmed" ? 1000 : dateConfidence === "likely_recurring" ? 700 : 300;
  fitScore += 100;
  if (ordered.length) fitScore += 50;
  if (keywordMatch(group, criteria)) fitScore += 50;
  if (recurring.length) fitScore += Math.min(recurring.length, 3) * 40;

  const chosenBooking = confirmed ?? recurring[0] ?? latest;
  const city = group.city ?? chosenBooking?.city ?? null;
  const region = group.region ?? chosenBooking?.region ?? null;

  return {
    organizationId: group.id,
    bookingId: chosenBooking?.id ?? null,
    label: group.name,
    city,
    region,
    dateFrom: confirmed ? dateOnly(confirmed.startsAt) : null,
    dateThrough: confirmed ? dateOnly(confirmed.endsAt ?? confirmed.startsAt) : null,
    dateConfidence,
    status: latest?.status ?? null,
    relationshipSummary: ordered.length
      ? `${ordered.length} ${dateConfidence === "likely_recurring" ? "prior " : ""}${ordered.length === 1 ? "booking" : "bookings"} on record`
      : null,
    reasons,
    fitScore,
  };
}

export class PostgresLeadScoutCrmSearch implements LeadScoutCrmSearch {
  private readonly db: Queryable;

  constructor(pool: Pool | Queryable = defaultPool as unknown as Pool) {
    this.db = pool as unknown as Queryable;
  }

  async search(criteria: LeadDiscoveryCriteria, limit = 8): Promise<AssistantLeadMatch[]> {
    const regions = [...new Set(criteria.regions.map((region) => region.trim().toUpperCase()).filter((region) => /^[A-Z]{2}$/.test(region)))];
    const boundedLimit = Math.max(1, Math.min(limit, 20));
    const params: unknown[] = [];
    let regionClause = "";
    if (regions.length) {
      const placeholders = regions.map((region) => {
        params.push(region);
        return `$${params.length}`;
      });
      regionClause = `and (upper(coalesce(o.region, '')) in (${placeholders.join(",")}) or upper(coalesce(b.region, '')) in (${placeholders.join(",")}))`;
    }

    const result = await this.db.query(
      `select
         o.id as organization_id,
         o.name as organization_name,
         o.city as organization_city,
         o.region as organization_region,
         b.id as booking_id,
         b.name as booking_name,
         b.city as booking_city,
         b.region as booking_region,
         b.starts_at,
         b.ends_at,
         b.status,
         b.created_at as booking_created_at
       from organizations o
       left join bookings b on b.organization_id = o.id
       where o.consolidated_into_id is null
       ${regionClause}
       order by o.name, b.starts_at desc nulls last, b.created_at desc nulls last`,
      params,
    );

    const groups = new Map<string, OrganizationGroup>();
    for (const row of result.rows) {
      const id = String(row.organization_id);
      const group: OrganizationGroup = groups.get(id) ?? {
        id,
        name: String(row.organization_name),
        city: row.organization_city ?? null,
        region: row.organization_region ?? null,
        bookings: [],
      };
      if (row.booking_id) {
        group.bookings.push({
          id: String(row.booking_id),
          name: String(row.booking_name ?? group.name),
          city: row.booking_city ?? null,
          region: row.booking_region ?? null,
          startsAt: safeDate(row.starts_at),
          endsAt: normalizeBookingEndDate(safeDate(row.ends_at)),
          status: row.status ?? null,
          createdAt: safeDate(row.booking_created_at) ?? new Date(0),
        });
      }
      groups.set(id, group);
    }

    const hasExplicitDateWindow = Boolean(requestedBounds(criteria));
    return [...groups.values()]
      .map((group) => rankGroup(group, criteria))
      .filter((match) => !hasExplicitDateWindow || match.dateConfidence !== "unknown")
      .sort((left, right) => right.fitScore - left.fitScore || left.label.localeCompare(right.label))
      .slice(0, boundedLimit);
  }
}
