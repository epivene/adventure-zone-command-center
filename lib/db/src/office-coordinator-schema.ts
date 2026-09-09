import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { communicationTemplates } from "./business-source-schema";
import { bookings, contacts, organizations } from "./schema";

export const officeRoleValues = ["office_coordinator"] as const;
export type OfficeRole = (typeof officeRoleValues)[number];

export const officeTaskTypeValues = [
  "contact_verification",
  "mail_brochure",
  "follow_up_prep",
  "research_update",
  "draft_email",
  "other",
] as const;
export type OfficeTaskType = (typeof officeTaskTypeValues)[number];

export const officeTaskStatusValues = [
  "todo",
  "in_progress",
  "waiting",
  "done",
  "cancelled",
] as const;
export type OfficeTaskStatus = (typeof officeTaskStatusValues)[number];

export const officeEmailStateValues = [
  "draft",
  "submitted",
  "needs_changes",
  "sending",
  "sent",
  "cancelled",
] as const;
export type OfficeEmailState = (typeof officeEmailStateValues)[number];

export const officeAccounts = pgTable("office_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  loginName: text("login_name").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").$type<OfficeRole>().default("office_coordinator").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  sessionVersion: bigint("session_version", { mode: "number" }).default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("office_accounts_login_name_lower_unique").on(sql`lower(${table.loginName})`),
  check("office_accounts_role_valid", sql`${table.role} = 'office_coordinator'`),
  check("office_accounts_session_version_positive", sql`${table.sessionVersion} >= 1`),
]);

export const officeTasks = pgTable("office_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  officeAccountId: uuid("office_account_id").notNull().references(() => officeAccounts.id, { onDelete: "restrict" }),
  taskType: text("task_type").$type<OfficeTaskType>().notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  status: text("status").$type<OfficeTaskStatus>().default("todo").notNull(),
  needsHelp: boolean("needs_help").default(false).notNull(),
  coordinatorNote: text("coordinator_note"),
  ownerSortOrder: bigint("owner_sort_order", { mode: "number" }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdBy: text("created_by").default("owner").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  check("office_tasks_type_valid", sql`${table.taskType} in ('contact_verification','mail_brochure','follow_up_prep','research_update','draft_email','other')`),
  check("office_tasks_status_valid", sql`${table.status} in ('todo','in_progress','waiting','done','cancelled')`),
  check("office_tasks_created_by_valid", sql`${table.createdBy} in ('owner','system')`),
  index("office_tasks_account_status_order_idx").on(table.officeAccountId, table.status, table.ownerSortOrder),
  index("office_tasks_needs_help_idx").on(table.officeAccountId, table.needsHelp),
]);

export const officeMailActivity = pgTable("office_mail_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  officeAccountId: uuid("office_account_id").notNull().references(() => officeAccounts.id, { onDelete: "restrict" }),
  taskId: uuid("task_id").references(() => officeTasks.id, { onDelete: "set null" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  recipientName: text("recipient_name"),
  address1Snapshot: text("address_1_snapshot"),
  address2Snapshot: text("address_2_snapshot"),
  citySnapshot: text("city_snapshot"),
  regionSnapshot: text("region_snapshot"),
  postalCodeSnapshot: text("postal_code_snapshot"),
  preparedAt: timestamp("prepared_at", { withTimezone: true }),
  mailedAt: timestamp("mailed_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("office_mail_activity_task_unique").on(table.taskId).where(sql`${table.taskId} is not null`),
  index("office_mail_activity_profile_mailed_idx").on(table.organizationId, table.mailedAt),
  index("office_mail_activity_account_created_idx").on(table.officeAccountId, table.createdAt),
]);

export const officeEmailDrafts = pgTable("office_email_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  officeAccountId: uuid("office_account_id").references(() => officeAccounts.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  eventYear: integer("event_year"),
  communicationTemplateId: uuid("communication_template_id").references(() => communicationTemplates.id, { onDelete: "set null" }),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  coordinatorNote: text("coordinator_note"),
  state: text("state").$type<OfficeEmailState>().default("draft").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  ownerReturnNote: text("owner_return_note"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentMessageId: text("sent_message_id"),
  lastSendError: text("last_send_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("office_email_drafts_state_valid", sql`${table.state} in ('draft','submitted','needs_changes','sending','sent','cancelled')`),
  check("office_email_drafts_event_year_valid", sql`${table.eventYear} is null or ${table.eventYear} between 2000 and 2200`),
  index("office_email_drafts_state_submitted_idx").on(table.state, table.submittedAt),
  index("office_email_drafts_account_updated_idx").on(table.officeAccountId, table.updatedAt),
  index("office_email_drafts_template_idx").on(table.communicationTemplateId),
  index("office_email_drafts_organization_year_idx").on(table.organizationId, table.eventYear),
]);

export const officeMessages = pgTable("office_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  officeAccountId: uuid("office_account_id").notNull().references(() => officeAccounts.id, { onDelete: "restrict" }),
  actorKind: text("actor_kind").notNull(),
  body: text("body").notNull(),
  readByOfficeAt: timestamp("read_by_office_at", { withTimezone: true }),
  readByOwnerAt: timestamp("read_by_owner_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("office_messages_actor_kind_valid", sql`${table.actorKind} in ('office','owner')`),
  index("office_messages_account_created_idx").on(table.officeAccountId, table.createdAt),
]);
