import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";

import { bookings, travelLegs } from "./schema/index";

export const bookingLegAssignments = pgTable(
  "booking_leg_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    assignedLegId: uuid("assigned_leg_id").references(() => travelLegs.id, { onDelete: "set null" }),
    suggestedLegId: uuid("suggested_leg_id").references(() => travelLegs.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    explanation: text("explanation").notNull(),
    warning: text("warning"),
    previousStopDriveMinutes: integer("previous_stop_drive_minutes"),
    nextStopDriveMinutes: integer("next_stop_drive_minutes"),
    confidence: text("confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("booking_leg_assignments_booking_unique").on(table.bookingId),
    index("booking_leg_assignments_suggested_leg_idx").on(table.suggestedLegId),
    check(
      "booking_leg_assignments_source_valid",
      sql`${table.source} in ('prior_year','route_score','manual','needs_review')`,
    ),
    check(
      "booking_leg_assignments_warning_valid",
      sql`${table.warning} is null or ${table.warning} in ('long_travel','major_travel_concern')`,
    ),
    check(
      "booking_leg_assignments_confidence_valid",
      sql`${table.confidence} in ('high','medium','low')`,
    ),
    check(
      "booking_leg_assignments_explanation_nonblank",
      sql`nullif(trim(${table.explanation}), '') is not null`,
    ),
    check(
      "booking_leg_assignments_drive_minutes_nonnegative",
      sql`(${table.previousStopDriveMinutes} is null or ${table.previousStopDriveMinutes} >= 0) and (${table.nextStopDriveMinutes} is null or ${table.nextStopDriveMinutes} >= 0)`,
    ),
  ],
);
