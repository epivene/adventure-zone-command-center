import { sql } from "drizzle-orm";
import { doublePrecision, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { bookings, travelLegs } from "@/db/schema";

export const eventLegLifecycle = pgTable("event_leg_lifecycle", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "restrict" }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkInTimeZone: text("check_in_time_zone"),
  checkInLatitude: doublePrecision("check_in_latitude"),
  checkInLongitude: doublePrecision("check_in_longitude"),
  checkInLocationStatus: text("check_in_location_status").default("not_requested").notNull(),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
  checkOutTimeZone: text("check_out_time_zone"),
  checkOutLatitude: doublePrecision("check_out_latitude"),
  checkOutLongitude: doublePrecision("check_out_longitude"),
  checkOutLocationStatus: text("check_out_location_status").default("not_requested").notNull(),
  wrapUpStatus: text("wrap_up_status").default("not_started").notNull(),
  wrapUpFinishedAt: timestamp("wrap_up_finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("event_leg_lifecycle_booking_leg_unique").on(table.bookingId, table.legId),
  index("event_leg_lifecycle_leg_status_idx").on(table.legId, table.wrapUpStatus),
]);

export async function ensureEventLegLifecycleSchema() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS event_leg_lifecycle (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT,
      checked_in_at timestamptz,
      check_in_time_zone text,
      check_in_latitude double precision,
      check_in_longitude double precision,
      check_in_location_status text NOT NULL DEFAULT 'not_requested',
      checked_out_at timestamptz,
      check_out_time_zone text,
      check_out_latitude double precision,
      check_out_longitude double precision,
      check_out_location_status text NOT NULL DEFAULT 'not_requested',
      wrap_up_status text NOT NULL DEFAULT 'not_started',
      wrap_up_finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT event_leg_lifecycle_check_in_location_status_valid CHECK (check_in_location_status IN ('captured','unavailable','denied','error','not_requested')),
      CONSTRAINT event_leg_lifecycle_check_out_location_status_valid CHECK (check_out_location_status IN ('captured','unavailable','denied','error','not_requested')),
      CONSTRAINT event_leg_lifecycle_wrap_up_status_valid CHECK (wrap_up_status IN ('not_started','incomplete','finished')),
      CONSTRAINT event_leg_lifecycle_checkout_after_checkin CHECK (checked_out_at IS NULL OR checked_in_at IS NOT NULL)
    );
    ALTER TABLE event_leg_lifecycle ADD COLUMN IF NOT EXISTS check_in_time_zone text;
    ALTER TABLE event_leg_lifecycle ADD COLUMN IF NOT EXISTS check_out_time_zone text;
    CREATE UNIQUE INDEX IF NOT EXISTS event_leg_lifecycle_booking_leg_unique ON event_leg_lifecycle(booking_id, leg_id);
    CREATE INDEX IF NOT EXISTS event_leg_lifecycle_leg_status_idx ON event_leg_lifecycle(leg_id, wrap_up_status);
  `));
}
