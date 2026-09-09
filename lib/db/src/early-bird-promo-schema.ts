import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bookingOpportunities } from "./booking-opportunity-schema";
import { commercialOfferRules } from "./commercial-offer-schema";
import { officeAccounts, officeEmailDrafts } from "./office-coordinator-schema";
import { bookings, contacts, followUps, organizations } from "./schema";

export const earlyBirdPromoStatusValues = [
  "active",
  "secured",
  "expired",
  "cancelled",
] as const;
export type EarlyBirdPromoStatus =
  (typeof earlyBirdPromoStatusValues)[number];

export const earlyBirdPromoSourceKindValues = [
  "office_email",
  "opportunity_email",
] as const;
export type EarlyBirdPromoSourceKind =
  (typeof earlyBirdPromoSourceKindValues)[number];

export const earlyBirdPromoEnrollments = pgTable(
  "early_bird_promo_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commercialOfferRuleId: uuid("commercial_offer_rule_id")
      .notNull()
      .references(() => commercialOfferRules.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").references(
      () => bookingOpportunities.id,
      { onDelete: "set null" },
    ),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    officeAccountId: uuid("office_account_id").references(
      () => officeAccounts.id,
      { onDelete: "set null" },
    ),
    eventYear: integer("event_year").notNull(),
    sourceKind: text("source_kind")
      .$type<EarlyBirdPromoSourceKind>()
      .notNull(),
    firstEmailRecordId: uuid("first_email_record_id").notNull(),
    firstGmailMessageId: text("first_gmail_message_id"),
    firstGmailThreadId: text("first_gmail_thread_id"),
    firstSentAt: timestamp("first_sent_at", { withTimezone: true }).notNull(),
    deadlineDate: date("deadline_date", { mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status")
      .$type<EarlyBirdPromoStatus>()
      .default("active")
      .notNull(),
    interestConfirmedAt: timestamp("interest_confirmed_at", {
      withTimezone: true,
    }),
    interestEvidenceMessageId: text("interest_evidence_message_id"),
    reminderDueAt: timestamp("reminder_due_at", { withTimezone: true }),
    reminderDraftId: uuid("reminder_draft_id").references(
      () => officeEmailDrafts.id,
      { onDelete: "set null" },
    ),
    reminderFollowUpId: uuid("reminder_follow_up_id").references(
      () => followUps.id,
      { onDelete: "set null" },
    ),
    depositReceivedAt: timestamp("deposit_received_at", {
      withTimezone: true,
    }),
    depositSource: text("deposit_source"),
    cancelReason: text("cancel_reason"),
    claimLeaseOwner: text("claim_lease_owner"),
    claimLeaseExpiresAt: timestamp("claim_lease_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("early_bird_promo_offer_org_year_unique").on(
      table.commercialOfferRuleId,
      table.organizationId,
      table.eventYear,
    ),
    index("early_bird_promo_due_idx").on(table.status, table.reminderDueAt),
    check(
      "early_bird_promo_status_valid",
      sql`${table.status} in ('active','secured','expired','cancelled')`,
    ),
    check(
      "early_bird_promo_source_valid",
      sql`${table.sourceKind} in ('office_email','opportunity_email')`,
    ),
    check(
      "early_bird_promo_year_valid",
      sql`${table.eventYear} between 2000 and 2200`,
    ),
    check(
      "early_bird_promo_window_valid",
      sql`${table.expiresAt} > ${table.firstSentAt}`,
    ),
  ],
);
