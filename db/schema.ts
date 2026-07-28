import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  bookingStatusValues,
  probabilityValues,
} from "@/features/bookings/booking-types";

export const bookingStatusEnum = pgEnum("booking_status", bookingStatusValues);
export const probabilityEnum = pgEnum("probability", probabilityValues);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  actRecordId: text("act_record_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  jobTitle: text("job_title"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  actRecordId: text("act_record_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const travelLegs = pgTable(
  "travel_legs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "travel_legs_sort_order_between_1_and_4",
      sql`${table.sortOrder} between 1 and 4`,
    ),
  ],
);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  primaryContactId: uuid("primary_contact_id").references(() => contacts.id),
  name: text("name").notNull(),
  venueName: text("venue_name"),
  address1: text("address_1"),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: bookingStatusEnum("status").default("new_lead").notNull(),
  probability: probabilityEnum("probability").default("possible").notNull(),
  travelLegId: uuid("travel_leg_id").references(() => travelLegs.id),
  actRecordId: text("act_record_id").unique(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const followUps = pgTable("follow_ups", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  kind: text("kind").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: text("outcome"),
  nextFollowUpId: uuid("next_follow_up_id").references(
    (): AnyPgColumn => followUps.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEntries = pgTable("audit_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  reversesEntryId: uuid("reverses_entry_id")
    .unique()
    .references((): AnyPgColumn => auditEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const actImportRuns = pgTable("act_import_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceFileName: text("source_file_name").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const actExternalLinks = pgTable(
  "act_external_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    actRecordId: text("act_record_id").notNull(),
    importRunId: uuid("import_run_id").references(() => actImportRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_external_links_entity_external_id_unique").on(
      table.entityType,
      table.actRecordId,
    ),
  ],
);

export const actContactSyncStates = pgTable(
  "act_contact_sync_states",
  {
    contactId: uuid("contact_id")
      .primaryKey()
      .references(() => contacts.id),
    baseSnapshot: jsonb("base_snapshot").$type<Record<string, string | null>>(),
    actEditedAt: timestamp("act_edited_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    localDirty: boolean("local_dirty").default(false).notNull(),
    state: text("state").default("unlinked").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "act_contact_sync_states_state_valid",
      sql`${table.state} in ('unlinked', 'synced', 'waiting', 'conflict')`,
    ),
  ],
);

export const actSyncRuns = pgTable(
  "act_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: text("status").default("previewing").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    activeQueueToken: uuid("active_queue_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "act_sync_runs_status_valid",
      sql`${table.status} in ('previewing', 'previewed', 'applying', 'partial', 'completed', 'failed')`,
    ),
  ],
);

export const actSyncOperations = pgTable(
  "act_sync_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => actSyncRuns.id),
    rowKey: text("row_key").notNull(),
    localContactId: uuid("local_contact_id").references(() => contacts.id),
    actRecordId: text("act_record_id"),
    category: text("category").notNull(),
    decision: text("decision"),
    status: text("status").default("pending").notNull(),
    baseSnapshot: jsonb("base_snapshot").$type<Record<string, string | null>>(),
    localSnapshot: jsonb("local_snapshot").$type<Record<string, string | null>>(),
    actSnapshot: jsonb("act_snapshot").$type<Record<string, string | null>>(),
    error: text("error"),
    retryable: boolean("retryable").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("act_sync_operations_run_row_unique").on(
      table.runId,
      table.rowKey,
    ),
    check(
      "act_sync_operations_status_valid",
      sql`${table.status} in ('pending', 'approved', 'applying', 'completed', 'failed', 'skipped')`,
    ),
  ],
);
