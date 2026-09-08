import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { officeAccounts } from "./office-coordinator-schema";

export const bossAccounts = pgTable("boss_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  loginName: text("login_name").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").$type<"boss">().default("boss").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  studioOfficeAccountId: uuid("studio_office_account_id").references(() => officeAccounts.id, { onDelete: "restrict" }),
  enabled: boolean("enabled").default(true).notNull(),
  sessionVersion: bigint("session_version", { mode: "number" }).default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("boss_accounts_login_name_lower_unique").on(sql`lower(${table.loginName})`),
  check("boss_accounts_role_valid", sql`${table.role} = 'boss'`),
  check("boss_accounts_session_version_positive", sql`${table.sessionVersion} >= 1`),
]);

export const bossAssignmentStatusValues = ["todo", "in_progress", "waiting", "done", "cancelled"] as const;
export type BossAssignmentStatus = (typeof bossAssignmentStatusValues)[number];

export const bossAssignments = pgTable("boss_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  assigneeKind: text("assignee_kind").$type<"office" | "owner">().notNull(),
  officeAccountId: uuid("office_account_id").references(() => officeAccounts.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  details: text("details"),
  priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().default("normal").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").$type<BossAssignmentStatus>().default("todo").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByBossId: uuid("created_by_boss_id").notNull().references(() => bossAccounts.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("boss_assignments_assignee_valid", sql`(${table.assigneeKind} = 'owner' AND ${table.officeAccountId} IS NULL) OR (${table.assigneeKind} = 'office' AND ${table.officeAccountId} IS NOT NULL)`),
  check("boss_assignments_priority_valid", sql`${table.priority} in ('low','normal','high','urgent')`),
  check("boss_assignments_status_valid", sql`${table.status} in ('todo','in_progress','waiting','done','cancelled')`),
  index("boss_assignments_office_status_idx").on(table.officeAccountId, table.status, table.dueAt),
  index("boss_assignments_owner_status_idx").on(table.assigneeKind, table.status, table.dueAt),
]);