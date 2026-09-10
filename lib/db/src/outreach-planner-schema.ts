import { sql } from "drizzle-orm";
import {
  pgTable,
  bigint,
  boolean,
  doublePrecision,
  uuid,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { travelLegs, bookings, resources } from "./schema";
import { bookingOpportunities } from "./booking-opportunity-schema";
const created = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const outreachOpenings = pgTable(
  "outreach_openings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    status: text("status")
      .$type<"open" | "filled" | "closed">()
      .notNull()
      .default("open"),
    eventYear: integer("event_year").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    legId: uuid("leg_id").references(() => travelLegs.id),
    quantities: jsonb("quantities").$type<Record<string, number>>().notNull(),
    createdAt: created(),
  },
  (t) => [
    check(
      "outreach_openings_status_valid",
      sql`${t.status} in ('open','filled','closed')`,
    ),
    check(
      "outreach_openings_window_valid",
      sql`${t.endsOn} >= ${t.startsOn} and extract(year from ${t.startsOn}) = ${t.eventYear} and extract(year from ${t.endsOn}) = ${t.eventYear} and ${t.eventYear} between 2000 and 2200`,
    ),
    check(
      "outreach_openings_quantities_valid",
      sql`jsonb_typeof(${t.quantities}) = 'object'`,
    ),
  ],
);
export const outreachCandidates = pgTable(
  "outreach_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => outreachOpenings.id),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => bookingOpportunities.id),
    tier: text("tier")
      .$type<
        "dedicated" | "convention" | "strong" | "filler" | "unclassified"
      >()
      .notNull()
      .default("unclassified"),
    manualRank: integer("manual_rank").notNull().default(0),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    cadenceOverride: jsonb("cadence_override").$type<{
      timelineReviewed?: boolean;
      days: [number, number, number];
      minimumGapDays: number;
      reason: string;
    }>(),
    decisionDueAt: timestamp("decision_due_at", { withTimezone: true }),
    meaningfulReplyAt: timestamp("meaningful_reply_at", { withTimezone: true }),
    conventionEndsOn: date("convention_ends_on"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    historyReview: jsonb("history_review").$type<{
      reviewedThrough: string;
      reason: string;
      fingerprint: string;
    }>(),
    sourceSnapshot: jsonb("source_snapshot").$type<Record<string, unknown>>(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("outreach_candidates_membership_unique").on(
      t.openingId,
      t.opportunityId,
    ),
    uniqueIndex("outreach_candidates_live_opportunity_unique")
      .on(t.opportunityId)
      .where(sql`${t.releasedAt} is null`),
    check("outreach_candidates_rank_valid", sql`${t.manualRank} >= 0`),
    check(
      "outreach_candidates_tier_valid",
      sql`${t.tier} in ('dedicated','convention','strong','filler','unclassified')`,
    ),
  ],
);
export const outreachAttempts = pgTable(
  "outreach_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => outreachCandidates.id),
    sourceId: text("source_id").notNull(),
    stage: text("stage")
      .$type<"initial" | "follow_up_1" | "follow_up_2">()
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actor: text("actor").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("outreach_attempts_source_unique").on(t.sourceId),
    uniqueIndex("outreach_attempts_stage_unique").on(t.candidateId, t.stage),
    check(
      "outreach_attempts_stage_valid",
      sql`${t.stage} in ('initial','follow_up_1','follow_up_2')`,
    ),
  ],
);
export const outreachResearchTasks = pgTable(
  "outreach_research_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => outreachOpenings.id),
    criteria: text("criteria").notNull(),
    qualificationCriteria: jsonb("qualification_criteria").$type<{
      startsOn: string;
      endsOn: string;
      quantities: Record<string, number>;
      geography: {
        latitude: number;
        longitude: number;
        radiusMiles: number;
        adjacentRegions: string[];
      };
    }>(),
    targetCount: integer("target_count").notNull().default(3),
    status: text("status").notNull().default("pending"),
    results:
      jsonb("results").$type<
        {
          opportunityId: string;
          sourceUrl: string;
          note: string;
          checkedAt?: string;
          startsOn?: string;
          endsOn?: string;
          contact?: string;
          quantities?: Record<string, number>;
          latitude?: number;
          longitude?: number;
          region?: string;
          dateConfidence?: "verified" | "unknown";
          contactConfidence?: "verified" | "unknown";
          fitConfidence?: "verified" | "unknown";
          qualified?: boolean;
        }[]
      >(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("outreach_research_criteria_unique").on(
      t.openingId,
      t.criteria,
    ),
  ],
);
export const outreachAudit = pgTable("outreach_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityId: uuid("entity_id").notNull(),
  detail: jsonb("detail").notNull(),
  createdAt: created(),
});

// The singleton is shared by holds and (Task 3B) all commitment writers.
export const outreachAllocationMutex = pgTable("outreach_allocation_mutex", {
  id: integer("id").primaryKey(),
  generation: integer("generation").notNull().default(0),
});
export const outreachBookingDemand = pgTable("outreach_booking_demand", {
  bookingId: uuid("booking_id")
    .primaryKey()
    .references(() => bookings.id),
  quantities: jsonb("quantities").$type<Record<string, number>>().notNull(),
  resourceIds: jsonb("resource_ids").$type<string[]>().notNull(),
  factsFingerprint: text("facts_fingerprint").notNull(),
  revision: integer("revision").notNull().default(1),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const outreachHolds = pgTable(
  "outreach_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => outreachCandidates.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => bookingOpportunities.id),
    legId: uuid("leg_id")
      .notNull()
      .references(() => travelLegs.id),
    eventStartsOn: date("event_starts_on").notNull(),
    eventEndsOn: date("event_ends_on").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    quantities: jsonb("quantities").$type<Record<string, number>>().notNull(),
    resourceIds: jsonb("resource_ids").$type<string[]>().notNull(),
    location: jsonb("location")
      .$type<{ latitude: number; longitude: number }>()
      .notNull(),
    demandFingerprint: text("demand_fingerprint").notNull(),
    revision: integer("revision").notNull().default(1),
    state: text("state")
      .$type<"active" | "released" | "expired" | "converted">()
      .notNull()
      .default("active"),
    owner: text("owner").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("outreach_holds_active_booking_unique")
      .on(t.bookingId)
      .where(sql`${t.state} = 'active'`),
    check(
      "outreach_holds_state_valid",
      sql`${t.state} in ('active','released','expired','converted')`,
    ),
    check(
      "outreach_holds_window_valid",
      sql`${t.startsOn} <= ${t.eventStartsOn} and ${t.eventStartsOn} <= ${t.eventEndsOn} and ${t.eventEndsOn} <= ${t.endsOn}`,
    ),
  ],
);

export const outreachWriteReceipts = pgTable("outreach_write_receipts", {
  transactionId: bigint("transaction_id", { mode: "bigint" }).primaryKey(),
  mode: text("mode").notNull(),
  source: text("source").notNull(),
  validated: boolean("validated").notNull().default(false),
  dirty: boolean("dirty").notNull().default(false),
  createdAt: created(),
});
export const outreachReconciliationFacts = pgTable(
  "outreach_reconciliation_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    bookingIds: jsonb("booking_ids").$type<string[]>().notNull(),
    factsFingerprint: text("facts_fingerprint").notNull(),
    state: text("state").notNull().default("needs_review"),
    detail: jsonb("detail").notNull(),
    createdAt: created(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
);
export const outreachRouteAnchors = pgTable("outreach_route_anchors", {
  id: uuid("id").defaultRandom().primaryKey(),
  legId: uuid("leg_id").references(() => travelLegs.id),
  resourceId: uuid("resource_id").references(() => resources.id),
  direction: text("direction").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  identityFingerprint: text("identity_fingerprint").notNull(),
  revision: integer("revision").notNull().default(1),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
