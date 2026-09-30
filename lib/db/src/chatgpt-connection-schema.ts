import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const chatgptConnections = pgTable("chatgpt_connections", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  clientId: text("client_id").notNull(),
  scopes: jsonb("scopes").notNull().default([]),
  grantId: text("grant_id").unique(),
  revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull().defaultNow(),
  lastUsedAt: time("last_used_at"),
});
export const chatgptOperations = pgTable(
  "chatgpt_operations",
  {
    id: uuid("id").primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => chatgptConnections.id),
    operation: text("operation").notNull(),
    requestKey: text("request_key").notNull(),
    inputHash: text("input_hash").notNull(),
    receipt: jsonb("receipt").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chatgpt_operations_connection_operation_key").on(
      t.connectionId,
      t.operation,
      t.requestKey,
    ),
  ],
);
export const chatgptOAuthClients = pgTable("chatgpt_oauth_clients", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const chatgptOAuthArtifacts = pgTable(
  "chatgpt_oauth_artifacts",
  {
    model: text("model").notNull(),
    idHash: text("id_hash").notNull(),
    payload: text("payload").notNull(),
    grantId: text("grant_id"),
    uid: text("uid"),
    userCode: text("user_code"),
    consumedAt: bigint("consumed_at", { mode: "number" }),
    expiresAt: time("expires_at"),
  },
  (t) => [primaryKey({ columns: [t.model, t.idHash] })],
);
export const chatgptLeadIdentities = pgTable("chatgpt_lead_identities", {
  identityHash: text("identity_hash").primaryKey(),
  profileId: uuid("profile_id").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const chatgptUpdateProposals = pgTable("chatgpt_update_proposals", {
  id: uuid("id").primaryKey(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => chatgptConnections.id),
  profileId: uuid("profile_id").notNull(),
  content: jsonb("content").notNull(),
  contentHash: text("content_hash").notNull(),
  revision: text("revision").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  approvalId: uuid("approval_id").unique(),
  approvedAt: time("approved_at"),
  approvalExpiresAt: time("approval_expires_at"),
  consumedAt: time("consumed_at"),
});
export const chatgptExternalDrafts = pgTable("chatgpt_external_drafts", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => chatgptConnections.id),
  content: jsonb("content").notNull(),
  revision: uuid("revision").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const chatgptRateWindows = pgTable("chatgpt_rate_windows", {
  connectionId: uuid("connection_id")
    .primaryKey()
    .references(() => chatgptConnections.id),
  windowStart: time("window_start").notNull(),
  calls: integer("calls").notNull(),
});
