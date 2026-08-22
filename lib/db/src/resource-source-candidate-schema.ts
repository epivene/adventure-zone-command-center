import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { businessSourceDocuments } from "./business-source-schema";
import { resources } from "./schema";

export const resourceSourceCandidateMatchStateValues = [
  "pending",
  "exact_match",
  "applied",
  "ignored",
] as const;
export type ResourceSourceCandidateMatchState =
  (typeof resourceSourceCandidateMatchStateValues)[number];

export const resourceSourceCandidates = pgTable(
  "resource_source_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => businessSourceDocuments.id, { onDelete: "cascade" }),
    sourceName: text("source_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    yearBuilt: integer("year_built").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    serialNumber: text("serial_number").notNull(),
    matchedResourceId: uuid("matched_resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    matchState: text("match_state")
      .$type<ResourceSourceCandidateMatchState>()
      .default("pending")
      .notNull(),
    matchNote: text("match_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("resource_source_candidates_source_serial_unique").on(
      table.sourceDocumentId,
      table.serialNumber,
    ),
    index("resource_source_candidates_state_idx").on(table.matchState),
    index("resource_source_candidates_normalized_name_idx").on(table.normalizedName),
    check(
      "resource_source_candidates_match_state_valid",
      sql`${table.matchState} in ('pending','exact_match','applied','ignored')`,
    ),
    check(
      "resource_source_candidates_year_built_range",
      sql`${table.yearBuilt} between 1900 and 2100`,
    ),
  ],
);
