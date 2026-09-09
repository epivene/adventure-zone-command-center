import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { travelLegs } from "./schema";
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
    status: text("status").notNull().default("pending"),
    results:
      jsonb("results").$type<
        { opportunityId: string; sourceUrl: string; note: string }[]
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
