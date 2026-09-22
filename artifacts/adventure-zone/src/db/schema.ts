// Re-export the real Drizzle schema from the shared workspace package.
// Table definitions are plain objects (no DB driver), safe to bundle.
export * from "@workspace/db/schema";
export * from "@workspace/db/event-date-coverage-schema";
