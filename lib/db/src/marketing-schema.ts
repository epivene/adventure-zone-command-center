import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { communicationTemplates } from "./business-source-schema";
import { contacts, organizations } from "./schema";

export const marketingCampaignStates = [
  "draft", "needs_review", "approved", "scheduled", "sending", "sent", "failed", "cancelled",
] as const;
export type MarketingCampaignState = (typeof marketingCampaignStates)[number];

export const marketingAudiences = pgTable("marketing_audiences", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("marketing_audiences_name_nonblank", sql`btrim(${table.name}) <> ''`),
]);

export const marketingAudienceMembers = pgTable("marketing_audience_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  audienceId: uuid("audience_id").notNull().references(() => marketingAudiences.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("marketing_audience_members_unique").on(table.audienceId, table.organizationId, table.contactId),
  index("marketing_audience_members_audience_idx").on(table.audienceId),
]);

export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  audienceId: uuid("audience_id").notNull().references(() => marketingAudiences.id, { onDelete: "restrict" }),
  templateId: uuid("template_id").notNull().references(() => communicationTemplates.id, { onDelete: "restrict" }),
  state: text("state").$type<MarketingCampaignState>().default("draft").notNull(),
  templateVersionSnapshot: text("template_version_snapshot"),
  templateNameSnapshot: text("template_name_snapshot"),
  subjectTemplateSnapshot: text("subject_template_snapshot"),
  bodyTemplateSnapshot: text("body_template_snapshot"),
  requiredPlaceholdersSnapshot: text("required_placeholders_snapshot").array(),
  subjectTemplate: text("subject_template"),
  bodyTemplate: text("body_template"),
  senderName: text("sender_name").notNull(),
  senderEmail: text("sender_email"),
  senderPhone: text("sender_phone"),
  extraValues: jsonb("extra_values").$type<Record<string, string | null>>().default(sql`'{}'::jsonb`).notNull(),
  audienceRevision: integer("audience_revision").default(0).notNull(),
  snapshotRevision: integer("snapshot_revision"),
  snapshotConfirmedAt: timestamp("snapshot_confirmed_at", { withTimezone: true }),
  snapshotRecipientCount: integer("snapshot_recipient_count"),
  snapshotExcluded: jsonb("snapshot_excluded").$type<Array<Record<string, unknown>>>().default(sql`'[]'::jsonb`).notNull(),
  requestedReviewBy: text("requested_review_by"),
  requestedReviewAt: timestamp("requested_review_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  sendStartedAt: timestamp("send_started_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("marketing_campaigns_state_schedule_idx").on(table.state, table.scheduledFor),
  check("marketing_campaigns_state_valid", sql`${table.state} in ('draft','needs_review','approved','scheduled','sending','sent','failed','cancelled')`),
  check("marketing_campaigns_name_nonblank", sql`btrim(${table.name}) <> ''`),
  check("marketing_campaigns_revision_valid", sql`${table.audienceRevision} >= 0 and (${table.snapshotRevision} is null or ${table.snapshotRevision} >= 0)`),
]);

export const marketingCampaignRecipients = pgTable("marketing_campaign_recipients", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => marketingCampaigns.id, { onDelete: "restrict" }),
  snapshotRevision: integer("snapshot_revision").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
  recipientEmail: text("recipient_email").notNull(),
  organizationName: text("organization_name").notNull(),
  contactName: text("contact_name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("marketing_campaign_recipients_snapshot_unique").on(table.campaignId, table.snapshotRevision, table.recipientEmail),
  index("marketing_campaign_recipients_campaign_idx").on(table.campaignId, table.snapshotRevision),
  check("marketing_campaign_recipients_email_normalized", sql`${table.recipientEmail} = lower(btrim(${table.recipientEmail}))`),
]);

export const marketingCampaignDeliveries = pgTable("marketing_campaign_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => marketingCampaigns.id, { onDelete: "restrict" }),
  recipientId: uuid("recipient_id").notNull().references(() => marketingCampaignRecipients.id, { onDelete: "restrict" }),
  state: text("state").$type<"pending" | "sending" | "sent" | "failed">().default("pending").notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  claimToken: uuid("claim_token"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("marketing_campaign_deliveries_recipient_unique").on(table.recipientId),
  index("marketing_campaign_deliveries_campaign_state_idx").on(table.campaignId, table.state),
  check("marketing_campaign_deliveries_state_valid", sql`${table.state} in ('pending','sending','sent','failed')`),
  check("marketing_campaign_deliveries_attempts_valid", sql`${table.attemptCount} >= 0`),
]);

export const marketingCampaignEvents = pgTable("marketing_campaign_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => marketingCampaigns.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  actorId: text("actor_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("marketing_campaign_events_history_idx").on(table.campaignId, table.createdAt)]);