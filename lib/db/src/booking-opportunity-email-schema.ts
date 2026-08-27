import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { bookingOpportunities } from "./booking-opportunity-schema";
import { contacts, organizations } from "./schema";

export const opportunityDraftPurposeValues = ["new_outreach", "follow_up", "reply"] as const;
export const opportunityEmailStateValues = ["draft", "scheduled", "sent", "failed", "cancelled"] as const;

export type OpportunityDraftPurpose = (typeof opportunityDraftPurposeValues)[number];
export type OpportunityEmailState = (typeof opportunityEmailStateValues)[number];

export const bookingOpportunityEmailState = pgTable(
  "booking_opportunity_email_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => bookingOpportunities.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    eventYear: integer("event_year").notNull(),
    purpose: text("purpose").$type<OpportunityDraftPurpose>().notNull(),
    state: text("state").$type<OpportunityEmailState>().default("draft").notNull(),
    gmailDraftId: text("gmail_draft_id"),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastFailureCode: text("last_failure_code"),
    lastFailureMessage: text("last_failure_message"),
    sendRequestKey: text("send_request_key"),
    scheduleRequestKey: text("schedule_request_key"),
    dispatchLeaseOwner: text("dispatch_lease_owner"),
    dispatchLeaseExpiresAt: timestamp("dispatch_lease_expires_at", { withTimezone: true }),
    dispatchAttemptCount: integer("dispatch_attempt_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("booking_opportunity_email_state_current_unique")
      .on(table.opportunityId)
      .where(sql`${table.state} in ('draft','scheduled','failed')`),
    uniqueIndex("booking_opportunity_email_state_send_request_unique")
      .on(table.sendRequestKey)
      .where(sql`${table.sendRequestKey} is not null`),
    uniqueIndex("booking_opportunity_email_state_schedule_request_unique")
      .on(table.scheduleRequestKey)
      .where(sql`${table.scheduleRequestKey} is not null`),
    index("booking_opportunity_email_state_ready_idx").on(table.state, table.updatedAt),
    index("booking_opportunity_email_state_gmail_thread_idx").on(table.gmailThreadId),
    index("booking_opportunity_email_state_dispatch_idx").on(
      table.state,
      table.scheduledFor,
      table.dispatchLeaseExpiresAt,
    ),
    check("booking_opportunity_email_state_event_year_valid", sql`${table.eventYear} between 2000 and 2200`),
    check("booking_opportunity_email_state_purpose_valid", sql`${table.purpose} in ('new_outreach','follow_up','reply')`),
    check("booking_opportunity_email_state_state_valid", sql`${table.state} in ('draft','scheduled','sent','failed','cancelled')`),
    check("booking_opportunity_email_state_recipient_valid", sql`length(trim(${table.recipientEmail})) > 0`),
  ],
);
