import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bookings, contacts, organizations } from "./schema";

export const opportunityStatusValues = [
  "new_lead",
  "researching",
  "ready_to_contact",
  "contacted",
  "follow_up",
  "interested",
  "booking_in_progress",
  "booked",
  "not_pursuing",
  "declined",
  "no_response",
  "territory_hold",
  "needs_review",
  "cancelled",
] as const;

export const opportunityPriorityValues = ["normal", "high", "urgent"] as const;

export type OpportunityStatus = (typeof opportunityStatusValues)[number];
export type OpportunityPriority = (typeof opportunityPriorityValues)[number];

export const bookingOpportunities = pgTable(
  "booking_opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    eventYear: integer("event_year").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    status: text("status")
      .$type<OpportunityStatus>()
      .default("new_lead")
      .notNull(),
    priority: text("priority")
      .$type<OpportunityPriority>()
      .default("normal")
      .notNull(),
    nextActionKind: text("next_action_kind"),
    nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
    holdReason: text("hold_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("booking_opportunities_organization_year_unique").on(
      table.organizationId,
      table.eventYear,
    ),
    index("booking_opportunities_status_due_idx").on(
      table.status,
      table.nextActionDueAt,
    ),
    index("booking_opportunities_booking_idx").on(table.bookingId),
    check(
      "booking_opportunities_event_year_valid",
      sql`${table.eventYear} between 2000 and 2200`,
    ),
    check(
      "booking_opportunities_status_valid",
      sql`${table.status} in ('new_lead','researching','ready_to_contact','contacted','follow_up','interested','booking_in_progress','booked','not_pursuing','declined','no_response','territory_hold','needs_review','cancelled')`,
    ),
    check(
      "booking_opportunities_priority_valid",
      sql`${table.priority} in ('normal','high','urgent')`,
    ),
  ],
);

export const bookingOpportunityQueueOverrides = pgTable(
  "booking_opportunity_queue_overrides",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => bookingOpportunities.id, { onDelete: "cascade" }),
    businessDate: date("business_date").notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    manualOrder: integer("manual_order"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.opportunityId, table.businessDate] }),
    index("booking_opportunity_queue_overrides_date_idx").on(
      table.businessDate,
      table.pinned,
      table.manualOrder,
    ),
    check(
      "booking_opportunity_queue_overrides_manual_order_valid",
      sql`${table.manualOrder} is null or ${table.manualOrder} >= 0`,
    ),
  ],
);
