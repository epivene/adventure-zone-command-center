import { defineConfig } from "drizzle-kit";

// Generation only reads the schema, but Drizzle Kit requires a URL in its config.
// The loopback default cannot reach a production database; real migrations use
// the DATABASE_URL supplied by the deployment environment.
const databaseUrl = process.env.DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:5432/adventure_zone";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
