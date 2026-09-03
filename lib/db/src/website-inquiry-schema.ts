import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bookings, contacts, organizations } from "./schema";

export const websiteInquiryStatusValues = [
  "new",
  "reviewing",
  "converted",
  "archived",
  "spam",
] as const;
export type WebsiteInquiryStatus = (typeof websiteInquiryStatusValues)[number];

export const websiteInquiryAlertStateValues = [
  "pending",
  "sending",
  "retry",
  "sent",
  "failed",
] as const;
export type WebsiteInquiryAlertState =
  (typeof websiteInquiryAlertStateValues)[number];

export const websiteInquiries = pgTable(
  "website_inquiries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id").notNull(),
    referenceCode: text("reference_code").notNull(),
    status: text("status")
      .$type<WebsiteInquiryStatus>()
      .default("new")
      .notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    eventName: text("event_name").notNull(),
    eventDate: date("event_date"),
    eventLocation: text("event_location"),
    packageInterest: text("package_interest"),
    message: text("message").notNull(),
    pageUrl: text("page_url").notNull(),
    sourceOrigin: text("source_origin").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    reviewedByKind: text("reviewed_by_kind").$type<"owner" | "office">(),
    reviewedById: text("reviewed_by_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    convertedContactId: uuid("converted_contact_id").references(
      () => contacts.id,
      { onDelete: "set null" },
    ),
    convertedOrganizationId: uuid("converted_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    convertedBookingId: uuid("converted_booking_id").references(
      () => bookings.id,
      { onDelete: "set null" },
    ),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    alertState: text("alert_state")
      .$type<WebsiteInquiryAlertState>()
      .default("pending")
      .notNull(),
    alertAttemptCount: integer("alert_attempt_count").default(0).notNull(),
    alertNextAttemptAt: timestamp("alert_next_attempt_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    alertLastAttemptAt: timestamp("alert_last_attempt_at", {
      withTimezone: true,
    }),
    alertFailureReason: text("alert_failure_reason"),
    alertDeliveredRecipients: jsonb("alert_delivered_recipients")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    alertLeaseOwner: text("alert_lease_owner"),
    alertLeaseExpiresAt: timestamp("alert_lease_expires_at", {
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
    uniqueIndex("website_inquiries_submission_id_unique").on(
      table.submissionId,
    ),
    uniqueIndex("website_inquiries_reference_code_unique").on(
      table.referenceCode,
    ),
    check(
      "website_inquiries_status_valid",
      sql`${table.status} in ('new','reviewing','converted','archived','spam')`,
    ),
    check(
      "website_inquiries_alert_state_valid",
      sql`${table.alertState} in ('pending','sending','retry','sent','failed')`,
    ),
    check(
      "website_inquiries_reviewer_kind_valid",
      sql`${table.reviewedByKind} is null or ${table.reviewedByKind} in ('owner','office')`,
    ),
    check(
      "website_inquiries_alert_attempt_count_nonnegative",
      sql`${table.alertAttemptCount} >= 0`,
    ),
    index("website_inquiries_status_created_idx").on(
      table.status,
      table.createdAt.desc(),
    ),
    index("website_inquiries_normalized_email_idx").on(table.normalizedEmail),
    index("website_inquiries_fingerprint_created_idx").on(
      table.contentFingerprint,
      table.createdAt.desc(),
    ),
    index("website_inquiries_alert_due_idx")
      .on(table.alertState, table.alertNextAttemptAt)
      .where(sql`${table.alertState} in ('pending','retry','sending')`),
  ],
);
