import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { googleWorkspaceConnections } from "./google-workspace-schema";
import { bookings } from "./schema/index";

export const operationalCalendarPackageKeys = ["zone", "pirates", "warrior"] as const;
export type OperationalCalendarPackageKey = (typeof operationalCalendarPackageKeys)[number];

export const operationalCalendarReviewStates = ["pending", "accepted", "rejected"] as const;
export type OperationalCalendarReviewState = (typeof operationalCalendarReviewStates)[number];

export const googleOperationalCalendarLinks = pgTable(
  "google_operational_calendar_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    packageKey: text("package_key").$type<OperationalCalendarPackageKey>().notNull(),
    etag: text("etag"),
    sourceChecksum: text("source_checksum").notNull(),
    lastAppSnapshot: jsonb("last_app_snapshot")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    reservedStartsAt: timestamp("reserved_starts_at", { withTimezone: true }).notNull(),
    reservedEndsAt: timestamp("reserved_ends_at", { withTimezone: true }).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("google_operational_calendar_links_event_unique").on(
      table.connectionId,
      table.calendarId,
      table.googleEventId,
    ),
    uniqueIndex("google_operational_calendar_links_booking_package_unique").on(
      table.connectionId,
      table.calendarId,
      table.bookingId,
      table.packageKey,
    ),
    index("google_operational_calendar_links_booking_idx").on(table.bookingId),
    check(
      "google_operational_calendar_links_package_key_valid",
      sql`${table.packageKey} in ('zone','pirates','warrior')`,
    ),
    check(
      "google_operational_calendar_links_identity_nonblank",
      sql`btrim(${table.calendarId}) <> '' and btrim(${table.googleEventId}) <> '' and btrim(${table.sourceChecksum}) <> ''`,
    ),
    check(
      "google_operational_calendar_links_window_valid",
      sql`${table.reservedEndsAt} >= ${table.reservedStartsAt}`,
    ),
    check(
      "google_operational_calendar_links_snapshot_object",
      sql`jsonb_typeof(${table.lastAppSnapshot}) = 'object'`,
    ),
  ],
);

export const googleOperationalCalendarReviews = pgTable(
  "google_operational_calendar_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleWorkspaceConnections.id, { onDelete: "cascade" }),
    linkId: uuid("link_id").references(() => googleOperationalCalendarLinks.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    reason: text("reason").notNull(),
    proposedChanges: jsonb("proposed_changes")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    state: text("state").$type<OperationalCalendarReviewState>().default("pending").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("google_operational_calendar_reviews_pending_idx").on(table.connectionId, table.createdAt),
    uniqueIndex("google_operational_calendar_reviews_pending_event_unique")
      .on(table.connectionId, table.calendarId, table.googleEventId)
      .where(sql`${table.state} = 'pending'`),
    check(
      "google_operational_calendar_reviews_state_valid",
      sql`${table.state} in ('pending','accepted','rejected')`,
    ),
    check(
      "google_operational_calendar_reviews_identity_nonblank",
      sql`btrim(${table.calendarId}) <> '' and btrim(${table.googleEventId}) <> '' and btrim(${table.reason}) <> ''`,
    ),
    check(
      "google_operational_calendar_reviews_changes_object",
      sql`jsonb_typeof(${table.proposedChanges}) = 'object'`,
    ),
  ],
);
