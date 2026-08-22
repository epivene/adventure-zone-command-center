import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const googleWorkspaceConnectionStatusValues = [
  "connected",
  "reauthorization_required",
  "disconnected",
] as const;
export type GoogleWorkspaceConnectionStatus =
  (typeof googleWorkspaceConnectionStatusValues)[number];

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
    unique("google_workspace_connections_account_email_unique").on(
      table.accountEmail,
    ),
    uniqueIndex("google_workspace_connections_single_active_unique")
      .on(sql`(1)`)
      .where(
        sql`${table.status} in ('connected', 'reauthorization_required')`,
      ),
    index("google_workspace_connections_status_idx").on(
      table.status,
      table.updatedAt,
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
