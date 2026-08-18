import { sql } from "drizzle-orm";
import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { crewWorkers, travelLegs } from "@/db/schema";

export const crewWorkerLegMemberships = pgTable("crew_worker_leg_memberships", {
  workerId: uuid("worker_id").notNull().references(() => crewWorkers.id, { onDelete: "cascade" }),
  legId: uuid("leg_id").notNull().references(() => travelLegs.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.workerId, table.legId] })]);

export async function ensureCrewWorkerLegMembershipSchema() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS crew_worker_leg_memberships (
      worker_id uuid NOT NULL REFERENCES crew_workers(id) ON DELETE CASCADE,
      leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (worker_id, leg_id)
    );
  `));
}
