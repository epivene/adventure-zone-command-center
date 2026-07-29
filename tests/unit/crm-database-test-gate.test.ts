import { describe, expect, it } from "vitest";

import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

describe("CRM PostgreSQL test gate", () => {
  it("uses the single disposable database URL", () => {
    expect(crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: "postgres://example.test/crm" })).toBe(
      "postgres://example.test/crm",
    );
  });

  it("fails closed for release tests without the disposable database URL", () => {
    expect(() => crmTestDatabaseUrl({ CRM_RELEASE_TESTS: "1" })).toThrow(
      "CRM_TEST_DATABASE_URL must be set when CRM_RELEASE_TESTS=1.",
    );
  });
});
