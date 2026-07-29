import { describe, expect, it } from "vitest";

import packageJson from "@/package.json";
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

  it("runs every package/resource PostgreSQL suite in the release database command", () => {
    expect(packageJson.scripts["test:crm-db"].split(/\s+/)).toEqual(
      expect.arrayContaining([
        "tests/integration/package-resource-migration.test.ts",
        "tests/integration/package-repository.test.ts",
        "tests/integration/package-resource-settings-repository.test.ts",
        "tests/integration/package-service.test.ts",
        "tests/integration/resource-repository.test.ts",
        "tests/integration/resource-service.test.ts",
        "tests/integration/booking-operations-summary.test.ts",
      ]),
    );
  });
});
