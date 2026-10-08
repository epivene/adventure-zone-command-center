import { pgTable, uuid, integer, jsonb, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./index";

// Optional annual facts never overwrite organization or booking data.
export const festivalEditions = pgTable("festival_editions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  year: integer("year").notNull(),
  details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("festival_editions_organization_year").on(table.organizationId, table.year),
  check("festival_editions_year_range", sql`${table.year} BETWEEN 1900 AND 2200`),
]);
export type FestivalEditionRecord = typeof festivalEditions.$inferSelect;
