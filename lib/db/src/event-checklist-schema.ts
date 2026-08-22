import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bookings, resources, travelLegs } from "./schema";

export const checklistPhaseValues = ["pre_event", "post_event"] as const;
export type ChecklistPhase = (typeof checklistPhaseValues)[number];
export const checklistRunStateValues = [
  "in_progress",
  "completed",
  "unable_to_complete",
] as const;
export type ChecklistRunState = (typeof checklistRunStateValues)[number];
export const checklistResultValues = [
  "acceptable",
  "needs_work_safe",
  "unsafe",
  "not_applicable",
] as const;
export type ChecklistResult = (typeof checklistResultValues)[number];
export const checklistFollowUpSyncValues = [
  "not_required",
  "pending",
  "synced",
  "needs_attention",
] as const;
export type ChecklistFollowUpSyncState =
  (typeof checklistFollowUpSyncValues)[number];
export const resourceConditionIssueStateValues = ["open", "resolved"] as const;
export type ResourceConditionIssueState =
  (typeof resourceConditionIssueStateValues)[number];
export const checklistOverrideActionValues = [
  "allow_ready_to_operate",
  "allow_checkout",
] as const;
export type ChecklistOverrideAction =
  (typeof checklistOverrideActionValues)[number];

export const eventChecklistTemplates = pgTable(
  "event_checklist_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phase: text("phase").$type<ChecklistPhase>().notNull(),
    version: integer("version").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_checklist_templates_code_unique").on(table.code),
    check(
      "event_checklist_templates_phase_valid",
      sql`${table.phase} in ('pre_event','post_event')`,
    ),
    check("event_checklist_templates_version_positive", sql`${table.version} > 0`),
  ],
);

export const eventChecklistTemplateItems = pgTable(
  "event_checklist_template_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => eventChecklistTemplates.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    scope: text("scope").$type<"site" | "resource">().notNull(),
    applicabilityTags: text("applicability_tags")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    safetyCritical: boolean("safety_critical").default(false).notNull(),
    sortOrder: integer("sort_order").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_checklist_template_items_template_code_unique").on(
      table.templateId,
      table.code,
    ),
    index("event_checklist_template_items_template_order_idx").on(
      table.templateId,
      table.sortOrder,
    ),
    check(
      "event_checklist_template_items_scope_valid",
      sql`${table.scope} in ('site','resource')`,
    ),
  ],
);

export const eventChecklistRuns = pgTable(
  "event_checklist_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientMutationId: uuid("client_mutation_id").notNull(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    legId: uuid("leg_id")
      .notNull()
      .references(() => travelLegs.id, { onDelete: "restrict" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => eventChecklistTemplates.id, { onDelete: "restrict" }),
    phase: text("phase").$type<ChecklistPhase>().notNull(),
    state: text("state").$type<ChecklistRunState>().default("in_progress").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    unableReason: text("unable_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_checklist_runs_client_mutation_unique").on(
      table.clientMutationId,
    ),
    uniqueIndex("event_checklist_runs_booking_leg_phase_unique").on(
      table.bookingId,
      table.legId,
      table.phase,
    ),
    index("event_checklist_runs_leg_state_idx").on(table.legId, table.state),
    check(
      "event_checklist_runs_phase_valid",
      sql`${table.phase} in ('pre_event','post_event')`,
    ),
    check(
      "event_checklist_runs_state_valid",
      sql`${table.state} in ('in_progress','completed','unable_to_complete')`,
    ),
    check(
      "event_checklist_runs_unable_reason_required",
      sql`${table.state} <> 'unable_to_complete' or nullif(trim(${table.unableReason}), '') is not null`,
    ),
  ],
);

export const eventChecklistItemResults = pgTable(
  "event_checklist_item_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => eventChecklistRuns.id, { onDelete: "cascade" }),
    templateItemId: uuid("template_item_id")
      .notNull()
      .references(() => eventChecklistTemplateItems.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    itemCodeSnapshot: text("item_code_snapshot").notNull(),
    itemLabelSnapshot: text("item_label_snapshot").notNull(),
    resourceNameSnapshot: text("resource_name_snapshot"),
    result: text("result").$type<ChecklistResult>(),
    note: text("note"),
    followUpSyncState: text("follow_up_sync_state")
      .$type<ChecklistFollowUpSyncState>()
      .default("not_required")
      .notNull(),
    clientMutationId: uuid("client_mutation_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_checklist_item_results_client_mutation_unique").on(
      table.clientMutationId,
    ),
    index("event_checklist_item_results_run_result_idx").on(table.runId, table.result),
    check(
      "event_checklist_item_results_result_valid",
      sql`${table.result} is null or ${table.result} in ('acceptable','needs_work_safe','unsafe','not_applicable')`,
    ),
    check(
      "event_checklist_item_results_followup_valid",
      sql`${table.followUpSyncState} in ('not_required','pending','synced','needs_attention')`,
    ),
  ],
);

export const eventChecklistAttachments = pgTable(
  "event_checklist_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => eventChecklistItemResults.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    storageKey: text("storage_key"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_checklist_attachments_client_mutation_unique").on(
      table.clientMutationId,
    ),
    index("event_checklist_attachments_result_idx").on(table.resultId),
  ],
);

export const resourceConditionIssues = pgTable(
  "resource_condition_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    checklistResultId: uuid("checklist_result_id")
      .notNull()
      .references(() => eventChecklistItemResults.id, { onDelete: "restrict" }),
    severity: text("severity").$type<"needs_work_safe" | "unsafe">().notNull(),
    state: text("state").$type<ResourceConditionIssueState>().default("open").notNull(),
    summary: text("summary").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("resource_condition_issues_result_unique").on(
      table.checklistResultId,
    ),
    index("resource_condition_issues_resource_state_idx").on(
      table.resourceId,
      table.state,
    ),
    check(
      "resource_condition_issues_severity_valid",
      sql`${table.severity} in ('needs_work_safe','unsafe')`,
    ),
    check(
      "resource_condition_issues_state_valid",
      sql`${table.state} in ('open','resolved')`,
    ),
    check(
      "resource_condition_issues_note_nonblank",
      sql`nullif(trim(${table.note}), '') is not null`,
    ),
  ],
);

export const eventChecklistOverrides = pgTable(
  "event_checklist_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => eventChecklistRuns.id, { onDelete: "cascade" }),
    action: text("action").$type<ChecklistOverrideAction>().notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_checklist_overrides_run_action_unique").on(
      table.runId,
      table.action,
    ),
    index("event_checklist_overrides_run_idx").on(table.runId),
    check(
      "event_checklist_overrides_action_valid",
      sql`${table.action} in ('allow_ready_to_operate','allow_checkout')`,
    ),
    check(
      "event_checklist_overrides_reason_nonblank",
      sql`nullif(trim(${table.reason}), '') is not null`,
    ),
  ],
);
