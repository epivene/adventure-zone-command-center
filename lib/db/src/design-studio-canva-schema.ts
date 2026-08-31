import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { officeAccounts } from "./office-coordinator-schema";
import { designProjects, designProjectVersions } from "./design-studio-schema";

export type EncryptedCanvaSecretRecord = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

export const designCanvaConnectionStatusValues = [
  "connected",
  "disconnected",
  "error",
] as const;
export type DesignCanvaConnectionStatus =
  (typeof designCanvaConnectionStatusValues)[number];

export const designCanvaLinkStatusValues = ["pending", "ready", "failed"] as const;
export type DesignCanvaLinkStatus = (typeof designCanvaLinkStatusValues)[number];

export const designCanvaConnections = pgTable(
  "design_canva_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    officeAccountId: uuid("office_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "cascade" }),
    canvaUserId: text("canva_user_id"),
    encryptedAccessToken: jsonb("encrypted_access_token")
      .$type<EncryptedCanvaSecretRecord>()
      .notNull(),
    encryptedRefreshToken: jsonb("encrypted_refresh_token")
      .$type<EncryptedCanvaSecretRecord | null>(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    status: text("status")
      .$type<DesignCanvaConnectionStatus>()
      .default("connected")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("design_canva_connections_account_unique").on(table.officeAccountId),
    check(
      "design_canva_connections_status_valid",
      sql`${table.status} in ('connected','disconnected','error')`,
    ),
    index("design_canva_connections_status_idx").on(table.status, table.updatedAt),
  ],
);

export const designProjectCanvaLinks = pgTable(
  "design_project_canva_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => designProjects.id, { onDelete: "cascade" }),
    designId: text("design_id").notNull(),
    importedVersionId: uuid("imported_version_id")
      .notNull()
      .references(() => designProjectVersions.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<DesignCanvaLinkStatus>()
      .default("pending")
      .notNull(),
    lastImportAt: timestamp("last_import_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("design_project_canva_links_project_unique").on(table.projectId),
    check(
      "design_project_canva_links_status_valid",
      sql`${table.status} in ('pending','ready','failed')`,
    ),
    index("design_project_canva_links_design_idx").on(table.designId),
  ],
);

/**
 * Short-lived PKCE state for a Canva authorization redirect. The verifier is
 * encrypted with the same Canva token key and deleted immediately after use.
 */
export const designCanvaOauthStates = pgTable(
  "design_canva_oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    officeAccountId: uuid("office_account_id")
      .notNull()
      .references(() => officeAccounts.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    encryptedCodeVerifier: jsonb("encrypted_code_verifier")
      .$type<EncryptedCanvaSecretRecord>()
      .notNull(),
    returnPath: text("return_path").notNull().default("/design-studio"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("design_canva_oauth_states_state_unique").on(table.state),
    index("design_canva_oauth_states_account_idx").on(table.officeAccountId, table.expiresAt),
  ],
);
