import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { isInboundCallingSchemaReady } from "./inbound-calling-schema";
it("checks real installed schema, missing columns and missing index", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY); CREATE TABLE contact_phones(id uuid PRIMARY KEY); CREATE TABLE call_sessions(id uuid PRIMARY KEY);",
    );
    expect(await isInboundCallingSchemaReady(db)).toBe(false);
    await db.exec(
      readFileSync(
        new URL(
          "../../../../lib/db/migrations/20260902_twilio_incoming_computer_calling.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(await isInboundCallingSchemaReady(db)).toBe(true);
    await db.exec(
      "BEGIN; ALTER TABLE inbound_voicemails DROP COLUMN deletion_error;",
    );
    expect(await isInboundCallingSchemaReady(db)).toBe(false);
    await db.exec(
      "ROLLBACK; BEGIN; DROP INDEX call_sessions_inbound_technical_session_unique;",
    );
    expect(await isInboundCallingSchemaReady(db)).toBe(false);
    await db.exec("ROLLBACK;");
    expect(await isInboundCallingSchemaReady(db)).toBe(true);
  } finally {
    await db.close();
  }
});
