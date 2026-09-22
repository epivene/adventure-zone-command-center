import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { organizations } from "./schema";

export const eventDateFactStatusValues = [
  "confirmed",
  "expected",
  "needs_review",
] as const;
export type EventDateFactStatus = (typeof eventDateFactStatusValues)[number];

export const eventDateSourceKindValues = ["internal", "web", "derived"] as const;
export type EventDateSourceKind = (typeof eventDateSourceKindValues)[number];

export type EventDateSourcePointer = {
  sourceType: string;
  sourceId: string;
  label: string;
};

export type EventDateRecurrenceRule =
  | { kind: "annual_date"; month: number; day: number; calculationYear: number }
  | {
      kind: "ordinal_weekday";
      month: number;
      ordinal: number;
      weekday: number;
      calculationYear: number;
    };

export const eventDateFacts = pgTable("event_date_facts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  status: text("status").$type<EventDateFactStatus>().notNull(),
  recurrenceRule: jsonb("recurrence_rule").$type<EventDateRecurrenceRule>(),
  rationale: text("rationale").notNull(),
  sourceKind: text("source_kind").$type<EventDateSourceKind>().notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceUrl: text("source_url"),
  sourceRecordType: text("source_record_type"),
  sourceRecordId: text("source_record_id"),
  sourcePointers: jsonb("source_pointers").$type<EventDateSourcePointer[]>().default([]).notNull(),
  researchedAt: timestamp("researched_at", { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  active: boolean("active").default(true).notNull(),
  supersededById: uuid("superseded_by_id").references(
    (): AnyPgColumn => eventDateFacts.id,
    { onDelete: "set null" },
  ),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("event_date_facts_one_active_per_org")
    .on(table.organizationId)
    .where(sql`${table.active} = true`),
  index("event_date_facts_effective_date_idx").on(
    table.organizationId,
    table.active,
    table.status,
    table.startsOn,
  ),
  check(
    "event_date_facts_status_valid",
    sql`${table.status} in ('confirmed', 'expected', 'needs_review')`,
  ),
  check(
    "event_date_facts_source_kind_valid",
    sql`${table.sourceKind} in ('internal', 'web', 'derived')`,
  ),
  check(
    "event_date_facts_range_valid",
    sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
  ),
]);

export const eventDateCoverageRunStatusValues = [
  "queued",
  "researching",
  "complete",
  "failed",
  "cancelled",
] as const;
export type EventDateCoverageRunStatus =
  (typeof eventDateCoverageRunStatusValues)[number];

export const eventDateCoverageRuns = pgTable("event_date_coverage_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status").$type<EventDateCoverageRunStatus>().default("queued").notNull(),
  batchSize: integer("batch_size").default(25).notNull(),
  requestedBy: text("requested_by"),
  selectedOrganizationIds: jsonb("selected_organization_ids").$type<string[]>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorDetail: text("error_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("event_date_coverage_runs_status_idx").on(table.status, table.createdAt),
  check(
    "event_date_coverage_runs_status_valid",
    sql`${table.status} in ('queued', 'researching', 'complete', 'failed', 'cancelled')`,
  ),
  check("event_date_coverage_runs_batch_size_positive", sql`${table.batchSize} > 0`),
]);

export const eventDateCoverageItemStatusValues = [
  "queued",
  "researching",
  "complete",
  "needs_review",
  "failed",
  "skipped",
] as const;
export type EventDateCoverageItemStatus =
  (typeof eventDateCoverageItemStatusValues)[number];

export const eventDateCoverageItems = pgTable("event_date_coverage_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => eventDateCoverageRuns.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status").$type<EventDateCoverageItemStatus>().default("queued").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  errorDetail: text("error_detail"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("event_date_coverage_items_run_org_unique").on(
    table.runId,
    table.organizationId,
  ),
  index("event_date_coverage_items_lease_idx").on(
    table.status,
    table.leaseExpiresAt,
    table.createdAt,
  ),
  check(
    "event_date_coverage_items_status_valid",
    sql`${table.status} in ('queued', 'researching', 'complete', 'needs_review', 'failed', 'skipped')`,
  ),
  check("event_date_coverage_items_attempts_nonnegative", sql`${table.attempts} >= 0`),
]);
