import { check, index, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const eventFamilies = pgTable(
  "event_families",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_families_normalized_name_unique").on(table.normalizedName),
    index("event_families_normalized_name_idx").on(table.normalizedName),
  ],
);

export const eventFamilyMembers = pgTable(
  "event_family_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    familyId: uuid("family_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    source: text("source").$type<"approved_rule" | "approved_ai" | "manual">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_family_members_organization_id_unique").on(table.organizationId),
    unique("event_family_members_family_organization_unique").on(table.familyId, table.organizationId),
    index("event_family_members_family_id_idx").on(table.familyId),
    check("event_family_members_source_valid", sql`${table.source} in ('approved_rule','approved_ai','manual')`),
  ],
);

export const eventFamilySuggestions = pgTable(
  "event_family_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposedName: text("proposed_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    candidateIds: jsonb("candidate_ids").$type<string[]>().notNull(),
    candidateFingerprint: text("candidate_fingerprint").notNull(),
    source: text("source").$type<"rule" | "ai">().notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").$type<"pending" | "approved" | "dismissed">().default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_family_suggestions_identity_unique").on(table.normalizedName, table.candidateFingerprint),
    index("event_family_suggestions_pending_idx").on(table.status, table.createdAt),
    check("event_family_suggestions_candidate_ids_array", sql`jsonb_typeof(${table.candidateIds}) = 'array'`),
    check("event_family_suggestions_source_valid", sql`${table.source} in ('rule','ai')`),
    check("event_family_suggestions_status_valid", sql`${table.status} in ('pending','approved','dismissed')`),
    check("event_family_suggestions_confidence_valid", sql`${table.confidence} >= 0 and ${table.confidence} <= 1`),
  ],
);
