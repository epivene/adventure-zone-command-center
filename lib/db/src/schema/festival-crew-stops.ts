import { pgTable, uuid, jsonb, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { festivalEditions } from "./festival-editions";

// Edition ownership survives organizer merges through the existing edition FK.
export const festivalCrewStops = pgTable("festival_crew_stops", {
  id: uuid("id").defaultRandom().primaryKey(),
  editionId: uuid("edition_id").notNull().references(() => festivalEditions.id, { onDelete: "cascade" }),
  sourceKey: text("source_key"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index("festival_crew_stops_edition_idx").on(table.editionId),
  uniqueIndex("festival_crew_stops_edition_source_unique").on(table.editionId, table.sourceKey).where(sql`${table.sourceKey} is not null`),
]);
export const insertFestivalCrewStopSchema = createInsertSchema(festivalCrewStops).omit({ id: true, updatedAt: true });
export type FestivalCrewStopRecord = typeof festivalCrewStops.$inferSelect;
