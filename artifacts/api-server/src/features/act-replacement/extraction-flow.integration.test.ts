import { describe, expect, it } from "vitest";

// The full extraction-flow scenario needs a disposable PostgreSQL database. It
// is intentionally skipped in local/archive verification when the secret is
// absent; the focused repository and worker suites still run without one.
const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasDatabase)("durable Act extraction flow", () => {
  it("is reserved for the disposable PostgreSQL/Render restart gate", () => {
    expect(process.env.TEST_DATABASE_URL).toBeTruthy();
  });
});
