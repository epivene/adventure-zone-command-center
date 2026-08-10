import app from "./app";
import { runActReviewMigrations } from "@workspace/db/migrations";
import { logger } from "./lib/logger";
import { validateOwnerConfig } from "./lib/auth";
import {
  createActExtractionRuntime,
  createActServerShutdown,
  type ActExtractionRuntime,
} from "./features/act-replacement/runtime";

// Fail fast if required owner config is absent — this is a single-owner CRM.
validateOwnerConfig();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const appliedMigrations = await runActReviewMigrations();
logger.info(
  { appliedMigrations },
  appliedMigrations.length > 0
    ? "Database migrations applied"
    : "Database schema is current",
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
    // Keep the API alive, but include the safe error class in Render logs so a
    // failed worker startup cannot masquerade as an empty Act import.
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
      server.close((error) => (error ? reject(error) : resolve()));
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
