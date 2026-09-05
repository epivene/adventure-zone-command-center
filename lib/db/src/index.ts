import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as coreSchema from "./schema";
import * as eventFamilySchema from "./event-family-schema";
import * as paperNoteSchema from "./paper-note-schema";
import * as businessSourceSchema from "./business-source-schema";
import * as commercialOfferSchema from "./commercial-offer-schema";
import * as eventChecklistSchema from "./event-checklist-schema";
import * as resourceSourceCandidateSchema from "./resource-source-candidate-schema";
import * as eventAttendanceHistorySchema from "./event-attendance-history-schema";
import * as officeCoordinatorSchema from "./office-coordinator-schema";
import * as bossSchema from "./boss-schema";
import * as websiteInquirySchema from "./website-inquiry-schema";
import * as googleWorkspaceSchema from "./google-workspace-schema";
import * as operationalCalendarSchema from "./operational-calendar-schema";
import * as leadIntakeSchema from "./lead-intake-schema";
import * as bookingOpportunitySchema from "./booking-opportunity-schema";
import * as bookingOpportunityEmailSchema from "./booking-opportunity-email-schema";
import * as legAssignmentSchema from "./leg-assignment-schema";
import * as designStudioCanvaSchema from "./design-studio-canva-schema";
import * as contractSchema from "./contract-schema";
import * as marketingSchema from "./marketing-schema";
import { normalizeDatabaseConnectionString } from "./connection-string";
import { databasePoolTimeouts } from "./pool-config";
import {
  designAssets,
  designCertificates,
  designOutputs,
  designProjectVersions,
  designProjects,
  designSmartFields,
  designTemplateFavorites,
  designTemplates,
} from "./design-studio-schema";

const { Pool } = pg;

const connectionString = process.env.RENDER_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Render's external PostgreSQL connection requires TLS. Use the explicit mode
// matching pg's current secure behavior so future pg/libpq changes cannot silently
// weaken certificate and hostname verification, and preserve existing URL params.
const finalConnectionString = normalizeDatabaseConnectionString(connectionString, {
  isRender: Boolean(process.env.RENDER_DATABASE_URL),
});

export const pool = new Pool({
  connectionString: finalConnectionString,
  application_name: "adventure-zone-command-center-api",
  ...databasePoolTimeouts(),
});
const schema = {
  ...coreSchema,
  ...eventFamilySchema,
  ...paperNoteSchema,
  ...businessSourceSchema,
  ...commercialOfferSchema,
  ...eventChecklistSchema,
  ...resourceSourceCandidateSchema,
  ...eventAttendanceHistorySchema,
  ...officeCoordinatorSchema,
  ...bossSchema,
  ...websiteInquirySchema,
  ...googleWorkspaceSchema,
  ...operationalCalendarSchema,
  ...leadIntakeSchema,
  ...bookingOpportunitySchema,
  ...bookingOpportunityEmailSchema,
  ...legAssignmentSchema,
  ...designStudioCanvaSchema,
  ...contractSchema,
  ...marketingSchema,
  designAssets,
  designCertificates,
  designOutputs,
  designProjectVersions,
  designProjects,
  designSmartFields,
  designTemplateFavorites,
  designTemplates,
};
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./event-family-schema";
export * from "./paper-note-schema";
export * from "./business-source-schema";
export * from "./commercial-offer-schema";
export * from "./event-checklist-schema";
export * from "./resource-source-candidate-schema";
export * from "./event-attendance-history-schema";
export * from "./office-coordinator-schema";
export * from "./boss-schema";
export * from "./website-inquiry-schema";
export * from "./google-workspace-schema";
export * from "./operational-calendar-schema";
export * from "./lead-intake-schema";
export * from "./booking-opportunity-schema";
export * from "./booking-opportunity-email-schema";
export * from "./leg-assignment-schema";
export * from "./design-studio-schema";
export * from "./contract-schema";
export * from "./design-studio-canva-schema";
export * from "./marketing-schema";
