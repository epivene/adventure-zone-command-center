import { asc, eq, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, organizations } from "@/db/schema";
import type { RelatedEventOpportunity } from "./profile-research-discovery";

export type RelatedEventRecord = {
  kind: "organization" | "booking";
  id: string;
  organizationId: string;
  name: string;
  city: string | null;
  region: string | null;
};

export type RelatedEventCrmMatch =
  | { status: "existing"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "possible_match"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "new_prospect" };

function exactNormalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyNormalize(value: string | null | undefined) {
  return exactNormalize(value)
    .replace(/\b(the|festival|fest|event|events)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(left: string, right: string) {
  const a = new Set(fuzzyNormalize(left).split(" ").filter(Boolean));
  const b = new Set(fuzzyNormalize(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

function sameLocation(event: RelatedEventOpportunity, record: RelatedEventRecord) {
  const eventRegion = exactNormalize(event.region);
  const recordRegion = exactNormalize(record.region);
  if (eventRegion && recordRegion && eventRegion !== recordRegion) return false;
  const eventCity = exactNormalize(event.city);
  const recordCity = exactNormalize(record.city);
  if (eventCity && recordCity && eventCity !== recordCity) return false;
  return true;
}

export function classifyRelatedEventAgainstRecords(
  event: RelatedEventOpportunity,
  records: RelatedEventRecord[],
): RelatedEventCrmMatch {
  const locationMatches = records.filter((record) => sameLocation(event, record));
  const exact = locationMatches.find((record) => exactNormalize(record.name) === exactNormalize(event.name));
  if (exact) {
    return {
      status: "existing",
      organizationId: exact.organizationId,
      ...(exact.kind === "booking" ? { bookingId: exact.id } : {}),
      matchedName: exact.name,
    };
  }

  const possible = locationMatches
    .map((record) => ({ record, score: tokenOverlap(record.name, event.name) }))
    .filter(({ score }) => score >= 0.67)
    .sort((left, right) => right.score - left.score)[0]?.record;
  if (possible) {
    return {
      status: "possible_match",
      organizationId: possible.organizationId,
      ...(possible.kind === "booking" ? { bookingId: possible.id } : {}),
      matchedName: possible.name,
    };
  }
  return { status: "new_prospect" };
}

type DrizzleDatabase = typeof database;

export async function matchRelatedEventsAgainstCrm(
  db: DrizzleDatabase,
  events: RelatedEventOpportunity[],
) {
  if (!events.length) return [];
  const regions = [...new Set(events.map((event) => event.region?.trim().toUpperCase()).filter(Boolean))] as string[];
  const regionCondition = regions.length ? or(...regions.map((region) => eq(organizations.region, region))) : undefined;
  const bookingRegionCondition = regions.length ? or(...regions.map((region) => eq(bookings.region, region))) : undefined;
  const organizationRows = await db.select({
    id: organizations.id,
    organizationId: organizations.id,
    name: organizations.name,
    city: organizations.city,
    region: organizations.region,
  }).from(organizations)
    .where(regionCondition)
    .orderBy(asc(organizations.name));
  const bookingRows = await db.select({
    id: bookings.id,
    organizationId: bookings.organizationId,
    name: bookings.name,
    city: bookings.city,
    region: bookings.region,
  }).from(bookings)
    .where(bookingRegionCondition)
    .orderBy(asc(bookings.name));

  const records: RelatedEventRecord[] = [
    ...organizationRows.map((row) => ({
      kind: "organization" as const,
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      city: row.city,
      region: row.region,
    })),
    ...bookingRows
      .filter((row): row is typeof row & { organizationId: string } => row.organizationId !== null)
      .map((row) => ({
        kind: "booking" as const,
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        city: row.city,
        region: row.region,
      })),
  ];

  return events.map((event) => ({
    ...event,
    crmMatch: classifyRelatedEventAgainstRecords(event, records),
  }));
}
