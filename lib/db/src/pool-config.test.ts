import { describe, expect, it } from "vitest";

import { databasePoolTimeouts } from "./pool-config";

describe("databasePoolTimeouts", () => {
  it("releases stalled queries before they can exhaust the shared pool", () => {
    expect(databasePoolTimeouts()).toEqual({
      connectionTimeoutMillis: 5_000,
      query_timeout: 30_000,
      statement_timeout: 15 * 60_000,
    });
  });
});
