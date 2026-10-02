import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  integer,
  jsonb,
  text,
  timestamp,
  boolean,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import {
  bookings,
  travelLegs,
  crewWorkers,
  resources,
  packageTemplates,
} from "./schema";
import { bossAccounts } from "./boss-schema";

const rev = () => integer("revision").notNull().default(1);
const payload = () => jsonb("payload").notNull();
export const legSeasonPlans = pgTable(
  "leg_season_plans",
  {
    legId: uuid("leg_id")
      .notNull()
      .references(() => travelLegs.id),
    seasonYear: integer("season_year").notNull(),
    revision: rev(),
    payload: payload(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "leg_season_plans_identity",
      columns: [t.legId, t.seasonYear],
    }),
  ],
);
export const crewAvailability = pgTable(
  "crew_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => crewWorkers.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    state: text("state").notNull(),
    revision: rev(),
    payload: payload(),
  },
  (t) => [
    index("crew_availability_worker_window").on(
      t.workerId,
      t.startsAt,
      t.endsAt,
    ),
    check("crew_availability_window", sql`${t.endsAt}>${t.startsAt}`),
  ],
);
export const packageSets = pgTable("package_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  packageId: uuid("package_id")
    .notNull()
    .references(() => packageTemplates.id),
  revision: rev(),
  payload: payload(),
});
export const packageSetMembers = pgTable(
  "package_set_members",
  {
    setId: uuid("set_id")
      .notNull()
      .references(() => packageSets.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
  },
  (t) => [
    primaryKey({
      name: "package_set_members_identity",
      columns: [t.setId, t.resourceId],
    }),
    index("package_set_members_resource").on(t.resourceId),
  ],
);
export const legEventPlans = pgTable(
  "leg_event_plans",
  {
    bookingId: uuid("booking_id")
      .primaryKey()
      .references(() => bookings.id),
    legId: uuid("leg_id")
      .notNull()
      .references(() => travelLegs.id),
    revision: rev(),
    draft: jsonb("draft").notNull(),
    committed: jsonb("committed"),
    invalidationReasons: jsonb("invalidation_reasons").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("leg_event_plans_leg").on(t.legId)],
);
export const legPlanCrewCommitments = pgTable(
  "leg_plan_crew_commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => crewWorkers.id),
    legId: uuid("leg_id")
      .notNull()
      .references(() => travelLegs.id),
    role: text("role").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("leg_plan_crew_identity").on(t.bookingId, t.workerId),
    index("leg_plan_crew_worker_window").on(t.workerId, t.startsAt, t.endsAt),
    check("leg_plan_crew_window", sql`${t.endsAt}>${t.startsAt}`),
  ],
);
export const legPlanSplits = pgTable(
  "leg_plan_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentLegId: uuid("parent_leg_id")
      .notNull()
      .references(() => travelLegs.id),
    bookingAId: uuid("booking_a_id")
      .notNull()
      .references(() => bookings.id),
    bookingBId: uuid("booking_b_id")
      .notNull()
      .references(() => bookings.id),
    revision: rev(),
  },
  (t) => [
    check("leg_plan_split_distinct", sql`${t.bookingAId}<>${t.bookingBId}`),
    index("leg_plan_splits_bookings").on(t.bookingAId, t.bookingBId),
  ],
);
export const legPlanAuthorities = pgTable("leg_plan_authorities", {
  singleton: integer("singleton").primaryKey().default(1),
  accountId: uuid("account_id").references(() => bossAccounts.id),
  revision: rev(),
});
export const legPlanApprovalRequests = pgTable(
  "leg_plan_approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentLegId: uuid("parent_leg_id")
      .notNull()
      .references(() => travelLegs.id),
    type: text("type").notNull(),
    bookingIds: jsonb("booking_ids").notNull(),
    planFingerprint: text("plan_fingerprint").notNull(),
    state: text("state").notNull().default("pending"),
    revision: rev(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("leg_plan_requests_bookings").using("gin", t.bookingIds)],
);
export const legPlanApprovalDecisions = pgTable(
  "leg_plan_approval_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => legPlanApprovalRequests.id),
    decision: text("decision").notNull(),
    actor: jsonb("actor").notNull(),
    authorityRevision: integer("authority_revision").notNull(),
    planFingerprint: text("plan_fingerprint").notNull(),
    reason: text("reason").notNull(),
    strategicAcknowledgement: boolean("strategic_acknowledgement")
      .notNull()
      .default(false),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("leg_plan_decisions_request").on(t.requestId, t.decidedAt)],
);
export const legPlanMutationReceipts = pgTable(
  "leg_plan_mutation_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorKey: text("actor_key").notNull(),
    requestKey: text("request_key").notNull(),
    bodyHash: text("body_hash").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("leg_plan_receipt_identity").on(t.actorKey, t.requestKey)],
);
