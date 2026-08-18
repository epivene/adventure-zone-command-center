import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/index.ts", "utf8");
const databaseSource = readFileSync("../../lib/db/src/index.ts", "utf8");

describe("stale database lock recovery startup wiring", () => {
  it("runs before schema checks and labels and bounds new PostgreSQL sessions", () => {
    const recoveryIndex = source.indexOf('"stale database lock recovery"');
    const bookingSchemaIndex = source.indexOf('"booking probability schema"');

    expect(recoveryIndex).toBeGreaterThan(-1);
    expect(bookingSchemaIndex).toBeGreaterThan(recoveryIndex);
    expect(source).toContain("recoverStaleDatabaseLockConvoys");
    expect(databaseSource).toContain(
      'application_name: "adventure-zone-command-center-api"',
    );
    expect(databaseSource).toContain("connectionTimeoutMillis: 5_000");
    expect(databaseSource).toContain("statement_timeout: 15 * 60_000");
  });
});
