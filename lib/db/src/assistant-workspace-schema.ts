import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  bigint,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
  date,
  boolean,
} from "drizzle-orm/pg-core";
export const assistantWorkspaceConversations = pgTable(
  "assistant_workspace_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: text("actor_id").notNull(),
    title: text("title").notNull(),
    selection: jsonb("selection").notNull(),
    summary: jsonb("summary").notNull().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.id, t.actorId),
    index("assistant_workspace_conversation_owner_idx").on(
      t.actorId,
      t.updatedAt,
    ),
  ],
);
export const assistantWorkspaceMessages = pgTable(
  "assistant_workspace_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    actorId: text("actor_id").notNull(),
    sequence: bigint("sequence", {
      mode: "number",
    }).generatedAlwaysAsIdentity(),
    requestKey: text("request_key").notNull(),
    role: text("role").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.actorId],
      foreignColumns: [
        assistantWorkspaceConversations.id,
        assistantWorkspaceConversations.actorId,
      ],
    }),
    unique().on(t.conversationId, t.requestKey, t.role),
    check(
      "assistant_workspace_message_role_valid",
      sql`${t.role} in ('user','assistant')`,
    ),
    index("assistant_workspace_message_order_idx").on(
      t.conversationId,
      t.sequence,
    ),
  ],
);
export const assistantWorkspaceActions = pgTable(
  "assistant_workspace_actions",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    actorId: text("actor_id").notNull(),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    expectedRevision: text("expected_revision"),
    connectionId: text("connection_id"),
    arguments: jsonb("arguments").notNull(),
    argumentFingerprint: text("argument_fingerprint").notNull(),
    sourceMessageId: uuid("source_message_id")
      .notNull()
      .references(() => assistantWorkspaceMessages.id),
    status: text("status").notNull().default("prepared"),
    result: jsonb("result"),
    workerId: text("worker_id"),
    leaseToken: integer("lease_token").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.actorId],
      foreignColumns: [
        assistantWorkspaceConversations.id,
        assistantWorkspaceConversations.actorId,
      ],
    }),
    unique().on(
      t.actorId,
      t.sourceMessageId,
      t.kind,
      t.targetId,
      t.argumentFingerprint,
    ),
    check(
      "assistant_workspace_action_status_valid",
      sql`${t.status} in ('prepared','running','provider_started','uncertain','succeeded','failed','cancelled')`,
    ),
    index("assistant_workspace_action_owner_idx").on(
      t.actorId,
      t.conversationId,
      t.createdAt,
    ),
  ],
);
export const assistantWorkspaceRuns = pgTable(
  "assistant_workspace_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    actorId: text("actor_id").notNull(),
    requestKey: text("request_key").notNull(),
    sourceMessageId: uuid("source_message_id")
      .notNull()
      .references(() => assistantWorkspaceMessages.id),
    status: text("status").notNull().default("queued"),
    checkpoint: jsonb("checkpoint").notNull().default({}),
    workerId: text("worker_id"),
    leaseToken: integer("lease_token").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.actorId],
      foreignColumns: [
        assistantWorkspaceConversations.id,
        assistantWorkspaceConversations.actorId,
      ],
    }),
    unique().on(t.conversationId, t.requestKey),
    check(
      "assistant_workspace_run_status_valid",
      sql`${t.status} in ('queued','running','waiting','succeeded','partial','failed','cancelled')`,
    ),
    uniqueIndex("assistant_workspace_one_active_run_idx")
      .on(t.conversationId)
      .where(sql`${t.status} in ('queued','running')`),
  ],
);
export const assistantWorkspaceEvents = pgTable(
  "assistant_workspace_events",
  {
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => assistantWorkspaceRuns.id),
    actorId: text("actor_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("assistant_workspace_event_run_idx").on(t.runId, t.sequence)],
);

export const assistantWorkspaceRuleHeads = pgTable(
  "assistant_workspace_rule_heads",
  {
    scopeKey: text("scope_key").primaryKey(),
    version: integer("version").notNull().default(0),
    currentId: uuid("current_id"),
  },
);
export const assistantWorkspaceRules = pgTable(
  "assistant_workspace_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeKey: text("scope_key")
      .notNull()
      .references(() => assistantWorkspaceRuleHeads.scopeKey),
    ruleKey: text("rule_key").notNull(),
    version: integer("version"),
    body: text("body").notNull(),
    sourceLabel: text("source_label").notNull(),
    organizationId: uuid("organization_id"),
    eventYear: integer("event_year"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull().default("proposed"),
    supersedesId: uuid("supersedes_id"),
    proposedBy: text("proposed_by").notNull(),
    approvedBy: text("approved_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.scopeKey, t.version),
    foreignKey({ columns: [t.supersedesId], foreignColumns: [t.id] }),
    check(
      "assistant_workspace_rule_status_valid",
      sql`${t.status} in ('proposed','approved','superseded')`,
    ),
    check(
      "assistant_workspace_rule_dates_valid",
      sql`${t.effectiveTo} is null or ${t.effectiveTo}>=${t.effectiveFrom}`,
    ),
  ],
);
export const assistantWorkspaceDrafts = pgTable(
  "assistant_workspace_drafts",
  {
    id: uuid("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    content: jsonb("content").notNull(),
    revision: text("revision").notNull(),
    status: text("status").notNull().default("local"),
    gmailDraftId: text("gmail_draft_id"),
    gmailHash: text("gmail_hash"),
    connectionId: text("connection_id"),
    messageId: text("message_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.actorId],
      foreignColumns: [
        assistantWorkspaceConversations.id,
        assistantWorkspaceConversations.actorId,
      ],
    }),
    check(
      "assistant_workspace_draft_status_valid",
      sql`${t.status} in ('local','saving','saved','sending','uncertain','sent')`,
    ),
  ],
);
export const assistantWorkspaceMutationResults = pgTable(
  "assistant_workspace_mutation_results",
  {
    actionId: uuid("action_id")
      .primaryKey()
      .references(() => assistantWorkspaceActions.id),
    actorId: text("actor_id").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const assistantWorkspaceSendReviews = pgTable(
  "assistant_workspace_send_reviews",
  {
    draftId: uuid("draft_id")
      .primaryKey()
      .references(() => assistantWorkspaceDrafts.id),
    actorId: text("actor_id").notNull(),
    revision: text("revision").notNull(),
    officeSnapshot: jsonb("office_snapshot").notNull(),
    raw: text("raw").notNull(),
    connectionId: text("connection_id").notNull(),
    paymentModel: text("payment_model").notNull(),
    approvedRevision: text("approved_revision"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    trackingComplete: boolean("tracking_complete").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "assistant_workspace_payment_model_valid",
      sql`${t.paymentModel} in ('prepaid','pay_per_play','administrative')`,
    ),
  ],
);
