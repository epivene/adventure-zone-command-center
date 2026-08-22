import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as coreSchema from "./schema";
import * as eventFamilySchema from "./event-family-schema";
import * as paperNoteSchema from "./paper-note-schema";
import * as businessSourceSchema from "./business-source-schema";
import * as commercialOfferSchema from "./commercial-offer-schema";
import * as eventChecklistSchema from "./event-checklist-schema";
import * as officeCoordinatorSchema from "./office-coordinator-schema";

const { Pool } = pg;

const connectionString = process.env.RENDER_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Render's external database URL requires SSL. When RENDER_DATABASE_URL is set
// and doesn't already include an sslmode param, we enforce SSL.
const isRender = Boolean(process.env.RENDER_DATABASE_URL);
const finalConnectionString =
  isRender && !connectionString.includes("sslmode")
    ? `${connectionString}?sslmode=require`
    : connectionString;

export const pool = new Pool({
  connectionString: finalConnectionString,
  application_name: "adventure-zone-command-center-api",
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15 * 60_000,
});
const schema = {
  ...coreSchema,
  ...eventFamilySchema,
  ...paperNoteSchema,
  ...businessSourceSchema,
  ...commercialOfferSchema,
  ...eventChecklistSchema,
  ...officeCoordinatorSchema,
};
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./event-family-schema";
export * from "./paper-note-schema";
export * from "./business-source-schema";
export * from "./commercial-offer-schema";
export * from "./event-checklist-schema";
export * from "./office-coordinator-schema";
