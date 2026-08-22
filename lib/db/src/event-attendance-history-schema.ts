import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { businessSourceDocuments } from "./business-source-schema";
import { organizationLocations, organizations } from "./schema";

export const attendanceHistoryStatusValues = [
  "attended",
  "blacklisted",
  "cancelled_last_minute",
] as const;
export type AttendanceHistoryStatus = (typeof attendanceHistoryStatusValues)[number];

export const attendanceImportMatchStateValues = [
  "pending",
  "confident",
  "approved",
  "new_profile_candidate",
  "rejected",
] as const;
export type AttendanceImportMatchState =
  (typeof attendanceImportMatchStateValues)[number];

export const attendanceImportRows = pgTable(
  "attendance_import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => businessSourceDocuments.id, { onDelete: "cascade" }),
    sourceRowNumber: integer("source_row_number").notNull(),
    month: text("month").notNull(),
    originalEventName: text("original_event_name").notNull(),
    originalLocation: text("original_location").notNull(),
    normalizedEventName: text("normalized_event_name").notNull(),
    normalizedLocation: text("normalized_location").notNull(),
    matchedOrganizationId: uuid("matched_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    matchedLocationId: uuid("matched_location_id").references(
      () => organizationLocations.id,
      { onDelete: "set null" },
    ),
    matchState: text("match_state")
      .$type<AttendanceImportMatchState>()
      .default("pending")
      .notNull(),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    matchReason: text("match_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attendance_import_rows_source_row_unique").on(
      table.sourceDocumentId,
      table.sourceRowNumber,
    ),
    index("attendance_import_rows_match_state_idx").on(table.matchState),
    index("attendance_import_rows_normalized_event_location_idx").on(
      table.normalizedEventName,
      table.normalizedLocation,
    ),
    check(
      "attendance_import_rows_match_state_valid",
      sql`${table.matchState} in ('pending','confident','approved','new_profile_candidate','rejected')`,
    ),
    check(
      "attendance_import_rows_source_row_positive",
      sql`${table.sourceRowNumber} > 0`,
    ),
    check(
      "attendance_import_rows_confidence_range",
      sql`${table.matchConfidence} is null or (${table.matchConfidence} >= 0 and ${table.matchConfidence} <= 1)`,
    ),
  ],
);

export const attendanceImportYearStatuses = pgTable(
  "attendance_import_year_statuses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importRowId: uuid("import_row_id")
      .notNull()
      .references(() => attendanceImportRows.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    status: text("status").$type<AttendanceHistoryStatus>().notNull(),
  },
  (table) => [
    uniqueIndex("attendance_import_year_statuses_row_year_unique").on(
      table.importRowId,
      table.year,
    ),
    check(
      "attendance_import_year_statuses_year_range",
      sql`${table.year} between 1900 and 2100`,
    ),
    check(
      "attendance_import_year_statuses_status_valid",
      sql`${table.status} in ('attended','blacklisted','cancelled_last_minute')`,
    ),
  ],
);

export const eventAttendanceHistory = pgTable(
  "event_attendance_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    organizationLocationId: uuid("organization_location_id").references(
      () => organizationLocations.id,
      { onDelete: "set null" },
    ),
    sourceImportRowId: uuid("source_import_row_id")
      .notNull()
      .references(() => attendanceImportRows.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    month: text("month").notNull(),
    status: text("status").$type<AttendanceHistoryStatus>().notNull(),
    originalEventName: text("original_event_name").notNull(),
    originalLocation: text("original_location").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_attendance_history_source_year_unique").on(
      table.sourceImportRowId,
      table.year,
    ),
    index("event_attendance_history_organization_year_idx").on(
      table.organizationId,
      table.year,
    ),
    index("event_attendance_history_status_year_idx").on(table.status, table.year),
    check(
      "event_attendance_history_status_valid",
      sql`${table.status} in ('attended','blacklisted','cancelled_last_minute')`,
    ),
  ],
);
