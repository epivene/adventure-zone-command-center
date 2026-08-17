import app from "./app";
import { runActReviewMigrations } from "@workspace/db/migrations";
import { logger } from "./lib/logger";
import { validateOwnerConfig } from "./lib/auth";
import { db } from "@workspace/db";
import { autoConsolidateImportedLocationFamilies } from "./features/organizations/imported-location-family-consolidation";
import { ensureEventFamilySchema } from "./features/event-families/event-family-repository";
import { ensureBookingProbabilitySchema } from "./features/bookings/booking-probability-schema";
import { ensureActivityDeleteSchema } from "./features/activities/activity-delete-schema";
import { ensurePackageIntelligenceSchema } from "./features/packages/package-intelligence-schema";
import { ensureBookingAssistantSchema } from "./features/assistant/assistant-schema";
import { ensureEventLegLifecycleSchema } from "./features/leg-manager/event-lifecycle-schema";
import { PostgresBusinessKnowledgeRepository } from "./features/assistant/business-knowledge-repository";
import {
  createActExtractionRuntime,
  createActServerShutdown,
  type ActExtractionRuntime,
} from "./features/act-replacement/runtime";

validateOwnerConfig();

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

await ensureBookingProbabilitySchema();
await ensurePackageIntelligenceSchema();
const assistantSchemaApplied = await ensureBookingAssistantSchema();
const appliedMigrations = await runActReviewMigrations();
if (assistantSchemaApplied) appliedMigrations.push("045_booking_assistant.sql");
await ensureEventFamilySchema();
await ensureActivityDeleteSchema();
await ensureEventLegLifecycleSchema();
await new PostgresBusinessKnowledgeRepository().upsertInitialSeed(
  "system:booking-assistant-seed",
);
logger.info(
  {
    appliedMigrations,
    releaseCommit: process.env["RENDER_GIT_COMMIT"] ?? "local",
  },
  appliedMigrations.length > 0
    ? "Database migrations applied"
    : "Database schema is current",
);

const importedLocationFamilies = await autoConsolidateImportedLocationFamilies(
  db,
  new Date(),
);
logger.info(
  importedLocationFamilies,
  importedLocationFamilies.families > 0
    ? "Imported organization profiles consolidated into locations"
    : "No imported location families need consolidation",
);

let extractionRuntime: ActExtractionRuntime | null = null;
let extractionRuntimePromise: Promise<ActExtractionRuntime> | null = null;
let shutdownRequested = false;

const server = app.listen(port, async () => {
  logger.info({ port }, "Server listening");

  try {
    extractionRuntimePromise = createActExtractionRuntime();
    const runtime = await extractionRuntimePromise;
    extractionRuntime = runtime;
    if (!shutdownRequested) runtime.start();
  } catch (err) {
    logger.error(
      {
        errorCode:
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "unknown",
      },
      "Act extraction worker could not be started",
    );
  }
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exitCode = 1;
});

const shutdown = createActServerShutdown({
  async closeRuntime() {
    const runtime =
      extractionRuntime ?? (await extractionRuntimePromise?.catch(() => null));
    await runtime?.close();
  },
  closeServer() {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve());
    });
  },
  async closePool() {
    const { pool } = await import("./db/client");
    await pool.end();
  },
  onError(stage) {
    logger.error({ stage }, "Server shutdown phase failed");
  },
});

process.once("SIGTERM", () => {
  shutdownRequested = true;
  void shutdown();
});
