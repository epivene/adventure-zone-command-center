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

  it("runs exactly the registered PostgreSQL suites in the release database command", () => {
    expect(packageJson.scripts["test:crm-db"].split(/\s+/).filter(
      (argument) => argument.startsWith("tests/integration/"),
    )).toEqual([
      "tests/integration/daily-crm-migration.test.ts",
      "tests/integration/organization-repository-postgres.test.ts",
      "tests/integration/activity-service.test.ts",
      "tests/integration/call-service.test.ts",
      "tests/integration/contact-repository.test.ts",
      "tests/integration/today-priority-postgres.test.ts",
      "tests/integration/package-resource-migration.test.ts",
      "tests/integration/package-repository.test.ts",
      "tests/integration/package-resource-settings-repository.test.ts",
      "tests/integration/package-service.test.ts",
      "tests/integration/resource-repository.test.ts",
      "tests/integration/resource-service.test.ts",
      "tests/integration/booking-operations-summary.test.ts",
      "tests/integration/place-person-relationship-migration.test.ts",
      "tests/integration/relationship-repository.test.ts",
      "tests/integration/booking-relationship-repository.test.ts",
      "tests/integration/relationship-reconciliation.test.ts",
    ]);
  });

  it("serializes hosted PostgreSQL suites with explicit database timeouts", () => {
    expect(packageJson.scripts["test:crm-db"].split(/\s+/)).toEqual(
      expect.arrayContaining([
        "--maxWorkers=1",
        "--testTimeout=120000",
        "--hookTimeout=120000",
      ]),
    );
  });
});
