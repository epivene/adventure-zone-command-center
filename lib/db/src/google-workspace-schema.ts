import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./schema/index";

export const googleWorkspaceConnectionStatusValues = [
  "connected",
  "reauthorization_required",
  "disconnected",
] as const;
export type GoogleWorkspaceConnectionStatus =
  (typeof googleWorkspaceConnectionStatusValues)[number];

export const googleWorkspaceConnectionRoleValues = [
  "workspace",
  "operational_calendar",
] as const;
export type GoogleWorkspaceConnectionRole =
  (typeof googleWorkspaceConnectionRoleValues)[number];

export const googleWorkspaceAuditActorValues = [
  "owner",
  "office",
  "system",
] as const;
export type GoogleWorkspaceAuditActor =
  (typeof googleWorkspaceAuditActorValues)[number];

export type EncryptedGoogleRefreshToken = {
  version: number;
  algorithm: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export const googleWorkspaceConnections = pgTable(
  "google_workspace_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountEmail: text("account_email").notNull(),
    role: text("role")
      .$type<GoogleWorkspaceConnectionRole>()
      .default("workspace")
      .notNull(),
    operationalCalendarId: text("operational_calendar_id"),
    status: text("status")
      .$type<GoogleWorkspaceConnectionStatus>()
      .default("connected")
      .notNull(),
    encryptedRefreshToken: jsonb("encrypted_refresh_token")
      .$type<EncryptedGoogleRefreshToken>()
      .notNull(),
    grantedScopes: jsonb("granted_scopes")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    googleSubject: text("google_subject"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("google_workspace_connections_account_email_role_unique").on(
      table.accountEmail,
      table.role,
    ),
    uniqueIndex("google_workspace_connections_active_role_unique")
      .on(table.role)
      .where(
        sql`${table.status} in ('connected', 'reauthorization_required')`,
      ),
    index("google_workspace_connections_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "google_workspace_connections_role_valid",
      sql`${table.role} in ('workspace', 'operational_calendar')`,
    ),
    check(
      "google_workspace_connections_operational_calendar_role_valid",
      sql`${table.role} = 'operational_calendar' or ${table.operationalCalendarId} is null`,
    ),
    check(
      "google_workspace_connections_status_valid",
      sql`${table.status} in ('connected', 'reauthorization_required', 'disconnected')`,
    ),
    check(
      "google_workspace_connections_encrypted_token_object",
      sql`jsonb_typeof(${table.encryptedRefreshToken}) = 'object'`,
    ),
    check(
      "google_workspace_connections_granted_scopes_array",
      sql`jsonb_typeof(${table.grantedScopes}) = 'array'`,
    ),
  ],
);

export const googleWorkspaceOauthStates = pgTable(
  "google_workspace_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    returnPath: text("return_path").notNull(),
    connectionRole: text("connection_role")
      .$type<GoogleWorkspaceConnectionRole>()
      .default("workspace")
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("google_workspace_oauth_states_unconsumed_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.consumedAt} is null`),
    check(
      "google_workspace_oauth_states_connection_role_valid",
      sql`${table.connectionRole} in ('workspace', 'operational_calendar')`,
    ),
    check(
      "google_workspace_oauth_states_return_path_nonblank",
      sql`btrim(${table.returnPath}) <> ''`,
    ),
  ],
);

export const googleWorkspaceLabelScopes = pgTable(
  "google_workspace_label_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    labelId: text("label_id").notNull(),
    labelName: text("label_name").notNull(),
    rootLabelId: text("root_label_id").notNull(),
    rootLabelName: text("root_label_name").notNull(),
    selected: boolean("selected").default(true).notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("google_workspace_label_scopes_connection_label_unique").on(
      table.connectionId,
      table.labelId,
    ),
    index("google_workspace_label_scopes_selected_idx")
      .on(table.connectionId, table.rootLabelId, table.labelId)
      .where(sql`${table.selected} = true`),
    check(
      "google_workspace_label_scopes_identity_nonblank",
      sql`btrim(${table.labelId}) <> '' and btrim(${table.labelName}) <> '' and btrim(${table.rootLabelId}) <> '' and btrim(${table.rootLabelName}) <> ''`,
    ),
  ],
);

export const googleWorkspaceCalendarScopes = pgTable(
  "google_workspace_calendar_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    summary: text("summary").notNull(),
    primaryCalendar: boolean("primary_calendar").default(false).notNull(),
    selected: boolean("selected").default(true).notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("google_workspace_calendar_scopes_connection_calendar_unique").on(
      table.connectionId,
      table.calendarId,
    ),
    index("google_workspace_calendar_scopes_selected_idx")
      .on(table.connectionId, table.calendarId)
      .where(sql`${table.selected} = true`),
    check(
      "google_workspace_calendar_scopes_identity_nonblank",
      sql`btrim(${table.calendarId}) <> '' and btrim(${table.summary}) <> ''`,
    ),
  ],
);

export const googleWorkspaceAuditEvents = pgTable(
  "google_workspace_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorKind: text("actor_kind").$type<GoogleWorkspaceAuditActor>().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("google_workspace_audit_events_created_idx").on(
      table.createdAt,
      table.id,
    ),
    check(
      "google_workspace_audit_events_actor_kind_valid",
      sql`${table.actorKind} in ('owner', 'office', 'system')`,
    ),
    check(
      "google_workspace_audit_events_action_nonblank",
      sql`btrim(${table.action}) <> ''`,
    ),
    check(
      "google_workspace_audit_events_target_type_nonblank",
      sql`btrim(${table.targetType}) <> ''`,
    ),
    check(
      "google_workspace_audit_events_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);


export const googleWorkspaceProfileLabelStateValues = [
  "active",
  "conflict",
  "unavailable",
] as const;
export type GoogleWorkspaceProfileLabelState =
  (typeof googleWorkspaceProfileLabelStateValues)[number];

export const googleWorkspaceGmailMutationStateValues = [
  "pending",
  "processing",
  "completed",
  "retryable_error",
  "permanent_error",
  "conflict",
] as const;
export type GoogleWorkspaceGmailMutationState =
  (typeof googleWorkspaceGmailMutationStateValues)[number];

export const googleWorkspaceGmailMutationOperationValues = [
  "assign_thread",
  "label_inbound_message",
] as const;
export type GoogleWorkspaceGmailMutationOperation =
  (typeof googleWorkspaceGmailMutationOperationValues)[number];

export const googleWorkspaceProfileLabels = pgTable(
  "google_workspace_profile_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    gmailLabelId: text("gmail_label_id").notNull(),
    gmailLabelName: text("gmail_label_name").notNull(),
    state: text("state")
      .$type<GoogleWorkspaceProfileLabelState>()
      .default("active")
      .notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique(
      "google_workspace_profile_labels_connection_organization_unique",
    ).on(table.connectionId, table.organizationId),
    unique("google_workspace_profile_labels_connection_label_unique").on(
      table.connectionId,
      table.gmailLabelId,
    ),
    check(
      "google_workspace_profile_labels_identity_nonblank",
      sql`btrim(${table.gmailLabelId}) <> '' and btrim(${table.gmailLabelName}) <> ''`,
    ),
    check(
      "google_workspace_profile_labels_state_valid",
      sql`${table.state} in ('active', 'conflict', 'unavailable')`,
    ),
  ],
);

export const googleWorkspaceGmailMutations = pgTable(
  "google_workspace_gmail_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    operation: text("operation")
      .$type<GoogleWorkspaceGmailMutationOperation>()
      .notNull(),
    targetLabelId: text("target_label_id"),
    removeLabelIds: jsonb("remove_label_ids")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state")
      .$type<GoogleWorkspaceGmailMutationState>()
      .default("pending")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    intentGeneration: integer("intent_generation"),
    lastErrorCode: text("last_error_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", {
      withTimezone: true,
    }),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("google_workspace_gmail_mutations_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("google_workspace_gmail_mutations_retry_idx").on(
      table.state,
      table.nextAttemptAt,
      table.processingLeaseExpiresAt,
    ),
    check(
      "google_workspace_gmail_mutations_identity_nonblank",
      sql`btrim(${table.messageId}) <> '' and btrim(${table.threadId}) <> '' and btrim(${table.idempotencyKey}) <> ''`,
    ),
    check(
      "google_workspace_gmail_mutations_operation_valid",
      sql`${table.operation} in ('assign_thread', 'label_inbound_message')`,
    ),
    check(
      "google_workspace_gmail_mutations_state_valid",
      sql`${table.state} in ('pending', 'processing', 'completed', 'retryable_error', 'permanent_error', 'conflict')`,
    ),
    check(
      "google_workspace_gmail_mutations_remove_labels_array",
      sql`jsonb_typeof(${table.removeLabelIds}) = 'array'`,
    ),
    check(
      "google_workspace_gmail_mutations_attempt_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);


export const googleWorkspaceGmailThreadIntentKindValues = [
  "assign",
  "ignore",
] as const;
export type GoogleWorkspaceGmailThreadIntentKind =
  (typeof googleWorkspaceGmailThreadIntentKindValues)[number];

export const googleWorkspaceGmailThreadIntents = pgTable(
  "google_workspace_gmail_thread_intents",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    generation: integer("generation").default(1).notNull(),
    intentKind: text("intent_kind")
      .$type<GoogleWorkspaceGmailThreadIntentKind>()
      .notNull(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "restrict" }),
    currentMutationId: uuid("current_mutation_id")
      .references(() => googleWorkspaceGmailMutations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("google_workspace_gmail_thread_intents_identity_unique").on(
      table.connectionId,
      table.threadId,
    ),
    index("google_workspace_gmail_thread_intents_mutation_idx")
      .on(table.currentMutationId)
      .where(sql`${table.currentMutationId} is not null`),
    check(
      "google_workspace_gmail_thread_intents_thread_nonblank",
      sql`btrim(${table.threadId}) <> ''`,
    ),
    check(
      "google_workspace_gmail_thread_intents_generation_positive",
      sql`${table.generation} > 0`,
    ),
    check(
      "google_workspace_gmail_thread_intents_kind_valid",
      sql`${table.intentKind} in ('assign', 'ignore')`,
    ),
    check(
      "google_workspace_gmail_thread_intents_assignment_consistent",
      sql`(${table.intentKind} = 'assign' and ${table.organizationId} is not null) or (${table.intentKind} = 'ignore' and ${table.organizationId} is null and ${table.currentMutationId} is null)`,
    ),
  ],
);
