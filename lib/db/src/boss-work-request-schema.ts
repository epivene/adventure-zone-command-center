import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { communicationTemplates } from "./business-source-schema";
import { bossAccounts } from "./boss-schema";
import { contacts, followUps, organizations } from "./schema";

export const bossWorkRequestTypeValues = [
  "rapid_convention_notes",
  "email_template_approval",
] as const;
export type BossWorkRequestType = (typeof bossWorkRequestTypeValues)[number];

export const bossWorkRequestStateValues = [
  "waiting_on_dave",
  "in_progress",
  "submitted_to_owner",
  "changes_requested",
  "returned_for_clarification",
  "approved",
  "applied",
  "cancelled",
] as const;
export type BossWorkRequestState = (typeof bossWorkRequestStateValues)[number];

export const bossWorkRequestPriorityValues = ["normal", "high", "urgent"] as const;
export type BossWorkRequestPriority = (typeof bossWorkRequestPriorityValues)[number];

export const bossWorkRequestActorKindValues = ["system", "owner", "boss"] as const;
export type BossWorkRequestActorKind = (typeof bossWorkRequestActorKindValues)[number];

export const communicationTemplateReviewDecisionValues = [
  "pending",
  "approved",
  "changes_requested",
] as const;
export type CommunicationTemplateReviewDecision =
  (typeof communicationTemplateReviewDecisionValues)[number];

export type ConventionNotesPayload = {
  eventName: string;
  organizationName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  eventDate?: string;
  packageInterest?: string[];
  personalDetails?: string;
  nextStep?: string;
  notes?: string;
};

export const bossWorkRequests = pgTable(
  "boss_work_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").$type<BossWorkRequestType>().notNull(),
    state: text("state").$type<BossWorkRequestState>().default("waiting_on_dave").notNull(),
    priority: text("priority").$type<BossWorkRequestPriority>().default("normal").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdByOwnerId: text("created_by_owner_id"),
    assignedBossAccountId: uuid("assigned_boss_account_id")
      .notNull()
      .references(() => bossAccounts.id, { onDelete: "restrict" }),
    deduplicationKey: text("deduplication_key"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("boss_work_requests_type_valid", sql`${table.type} in ('rapid_convention_notes','email_template_approval')`),
    check("boss_work_requests_state_valid", sql`${table.state} in ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification','approved','applied','cancelled')`),
    check("boss_work_requests_priority_valid", sql`${table.priority} in ('normal','high','urgent')`),
    index("boss_work_requests_assignee_state_due_idx").on(table.assignedBossAccountId, table.state, table.dueAt),
    uniqueIndex("boss_work_requests_assignee_dedupe_unique")
      .on(table.assignedBossAccountId, table.deduplicationKey)
      .where(sql`${table.deduplicationKey} is not null`),
  ],
);

export const bossWorkRequestEvents = pgTable(
  "boss_work_request_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull().references(() => bossWorkRequests.id, { onDelete: "cascade" }),
    actorKind: text("actor_kind").$type<BossWorkRequestActorKind>().notNull(),
    actorId: text("actor_id"),
    priorState: text("prior_state").$type<BossWorkRequestState>(),
    newState: text("new_state").$type<BossWorkRequestState>().notNull(),
    note: text("note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("boss_work_request_events_actor_valid", sql`${table.actorKind} in ('system','owner','boss')`),
    check("boss_work_request_events_new_state_valid", sql`${table.newState} in ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification','approved','applied','cancelled')`),
    check("boss_work_request_events_prior_state_valid", sql`${table.priorState} is null or ${table.priorState} in ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification','approved','applied','cancelled')`),
    index("boss_work_request_events_request_created_idx").on(table.requestId, table.createdAt),
  ],
);

export const bossConventionDrafts = pgTable(
  "boss_convention_drafts",
  {
    requestId: uuid("request_id").notNull().references(() => bossWorkRequests.id, { onDelete: "cascade" }),
    bossAccountId: uuid("boss_account_id").notNull().references(() => bossAccounts.id, { onDelete: "cascade" }),
    clientRevision: integer("client_revision").default(0).notNull(),
    payload: jsonb("payload").$type<ConventionNotesPayload>().default({ eventName: "" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.requestId, table.bossAccountId], name: "boss_convention_drafts_pk" }),
    check("boss_convention_drafts_revision_nonnegative", sql`${table.clientRevision} >= 0`),
  ],
);

export const bossConventionSubmissions = pgTable(
  "boss_convention_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull().references(() => bossWorkRequests.id, { onDelete: "cascade" }),
    bossAccountId: uuid("boss_account_id").notNull().references(() => bossAccounts.id, { onDelete: "restrict" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    payload: jsonb("payload").$type<ConventionNotesPayload>().notNull(),
    editVersion: integer("edit_version").default(1).notNull(),
    appliedOrganizationId: uuid("applied_organization_id").references(() => organizations.id, { onDelete: "set null" }),
    appliedContactId: uuid("applied_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    appliedFollowUpId: uuid("applied_follow_up_id").references(() => followUps.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("boss_convention_submissions_request_mutation_unique").on(table.requestId, table.clientMutationId),
    index("boss_convention_submissions_request_created_idx").on(table.requestId, table.createdAt),
    check("boss_convention_submissions_edit_version_positive", sql`${table.editVersion} >= 1`),
  ],
);

export const communicationTemplateReviews = pgTable(
  "communication_template_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull().references(() => bossWorkRequests.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").notNull().references(() => communicationTemplates.id, { onDelete: "restrict" }),
    templateVersion: text("template_version"),
    contentFingerprint: text("content_fingerprint").notNull(),
    subjectSnapshot: text("subject_snapshot"),
    bodySnapshot: text("body_snapshot").notNull(),
    bodyFormatSnapshot: text("body_format_snapshot").$type<"plain_text" | "html">().notNull(),
    decision: text("decision").$type<CommunicationTemplateReviewDecision>().default("pending").notNull(),
    note: text("note"),
    decidedByBossAccountId: uuid("decided_by_boss_account_id").references(() => bossAccounts.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("communication_template_reviews_request_unique").on(table.requestId),
    index("communication_template_reviews_template_version_idx").on(table.templateId, table.templateVersion),
    check("communication_template_reviews_format_valid", sql`${table.bodyFormatSnapshot} in ('plain_text','html')`),
    check("communication_template_reviews_decision_valid", sql`${table.decision} in ('pending','approved','changes_requested')`),
  ],
);
