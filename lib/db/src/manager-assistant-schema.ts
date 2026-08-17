import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bookings, travelLegs, trips } from "./schema/index";

export const managerAdminQuestions = pgTable(
  "manager_admin_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientMutationId: text("client_mutation_id").notNull(),
    travelLegId: uuid("travel_leg_id")
      .notNull()
      .references(() => travelLegs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    managerSessionSubject: text("manager_session_subject").notNull(),
    question: text("question").notNull(),
    urgency: text("urgency").default("normal").notNull(),
    status: text("status").default("needs_answer").notNull(),
    escalationReason: text("escalation_reason").notNull(),
    checkedSourceRefs: jsonb("checked_source_refs").$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
    contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("manager_admin_questions_client_mutation_unique").on(table.clientMutationId),
    check(
      "manager_admin_questions_question_nonblank",
      sql`nullif(trim(${table.question}), '') is not null`,
    ),
    check(
      "manager_admin_questions_escalation_nonblank",
      sql`nullif(trim(${table.escalationReason}), '') is not null`,
    ),
    check(
      "manager_admin_questions_urgency_valid",
      sql`${table.urgency} in ('normal','urgent')`,
    ),
    check(
      "manager_admin_questions_status_valid",
      sql`${table.status} in ('needs_answer','answered','resolved')`,
    ),
    index("manager_admin_questions_status_urgency_created_idx").on(
      table.status,
      table.urgency,
      table.createdAt,
    ),
    index("manager_admin_questions_leg_idx").on(table.travelLegId),
    index("manager_admin_questions_booking_idx").on(table.bookingId),
  ],
);

export const managerAdminQuestionResponses = pgTable(
  "manager_admin_question_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => managerAdminQuestions.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "manager_admin_question_responses_actor_type_valid",
      sql`${table.actorType} in ('admin','manager')`,
    ),
    check(
      "manager_admin_question_responses_body_nonblank",
      sql`nullif(trim(${table.body}), '') is not null`,
    ),
    index("manager_admin_question_responses_question_created_idx").on(
      table.questionId,
      table.createdAt,
    ),
  ],
);

export const operationsKnowledgeEntries = pgTable(
  "operations_knowledge_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    scope: text("scope").notNull(),
    scopeRecordId: text("scope_record_id"),
    sourceAdminQuestionId: uuid("source_admin_question_id").references(
      () => managerAdminQuestions.id,
      { onDelete: "set null" },
    ),
    active: boolean("active").default(true).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).defaultNow().notNull(),
    reviewAfter: timestamp("review_after", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "operations_knowledge_entries_scope_valid",
      sql`${table.scope} in ('global','package','resource','site','leg')`,
    ),
    check(
      "operations_knowledge_entries_title_nonblank",
      sql`nullif(trim(${table.title}), '') is not null`,
    ),
    check(
      "operations_knowledge_entries_body_nonblank",
      sql`nullif(trim(${table.body}), '') is not null`,
    ),
    index("operations_knowledge_entries_active_effective_idx").on(
      table.active,
      table.effectiveAt,
    ),
    index("operations_knowledge_entries_scope_idx").on(
      table.scope,
      table.scopeRecordId,
    ),
  ],
);
