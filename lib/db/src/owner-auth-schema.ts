import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ownerRoleValues = ["owner"] as const;
export type OwnerRole = (typeof ownerRoleValues)[number];

export const ownerAccounts = pgTable("owner_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  singletonKey: text("singleton_key").default("primary").notNull(),
  loginName: text("login_name").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").$type<OwnerRole>().default("owner").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  sessionVersion: bigint("session_version", { mode: "number" }).default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("owner_accounts_singleton_unique").on(table.singletonKey),
  uniqueIndex("owner_accounts_login_name_lower_unique").on(sql`lower(${table.loginName})`),
  check("owner_accounts_singleton_valid", sql`${table.singletonKey} = 'primary'`),
  check("owner_accounts_role_valid", sql`${table.role} = 'owner'`),
  check("owner_accounts_session_version_positive", sql`${table.sessionVersion} >= 1`),
]);
