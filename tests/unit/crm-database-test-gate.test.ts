import { describe, expect, it } from "vitest";

import packageJson from "@/package.json";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

describe("CRM PostgreSQL test gate", () => {
  it.each([
    "postgres://database.example/crm_test",
    "postgresql://database.example/test-crm",
    "postgres://database.example/test",
    "postgres://database.example/CRM_TEST_BACKUP",
    "postgres://localhost/crm_test",
    "postgres://[::1]/crm_test",
  ])("accepts a PostgreSQL URL with a delimited test database name", (url) => {
    expect(crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: url })).toBe(url);
  });

  it.each([
    ["comma-separated hosts", "postgres://prod,other/crm_test"],
    [
      "comma-separated hosts with ports",
      "postgres://prod:5432,other:5432/crm_test",
    ],
    ["encoded comma-separated hosts", "postgres://prod%2Cother/crm_test"],
  ])("rejects a multihost authority: %s", (_case, url) => {
    expect(() => crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: url })).toThrow(
      "CRM_TEST_DATABASE_URL must use exactly one URL authority host.",
    );
  });

  it.each([
    ["host", "postgres://safe.example/crm_test?host=prod.example"],
    ["hostname", "postgres://safe.example/crm_test?hostname=prod.example"],
    ["hostaddr", "postgres://safe.example/crm_test?hostaddr=192.0.2.1"],
  ])("rejects a host override parameter: %s", (_case, url) => {
    expect(() => crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: url })).toThrow(
      "CRM_TEST_DATABASE_URL must not use host override parameters.",
    );
  });

  it.each([
    ["a malformed URL", "not-a-url"],
    ["a non-PostgreSQL URL", "https://database.example/crm_test"],
  ])("rejects %s", (_case, url) => {
    expect(() => crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: url })).toThrow(
      "CRM_TEST_DATABASE_URL must be a valid PostgreSQL URL.",
    );
  });

  it.each([
    ["a missing host", "postgres:///crm_test"],
    ["a missing database", "postgres://database.example"],
  ])("rejects %s", (_case, url) => {
    expect(() => crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: url })).toThrow(
      "CRM_TEST_DATABASE_URL must include a host and database name.",
    );
  });

  it.each([
    ["ordinary production name", "postgres://database.example/crm"],
    ["embedded token", "postgres://database.example/contest"],
    ["test prefix without a delimiter", "postgres://database.example/testing"],
  ])("rejects a production-shaped database name: %s", (_case, url) => {
    expect(() => crmTestDatabaseUrl({ CRM_TEST_DATABASE_URL: url })).toThrow(
      "CRM_TEST_DATABASE_URL database name must contain a delimited 'test' token.",
    );
  });

  it("rejects the same normalized database identity as DATABASE_URL", () => {
    expect(() =>
      crmTestDatabaseUrl({
        CRM_TEST_DATABASE_URL:
          "postgres://DB.EXAMPLE:5432/CRM_TEST?sslmode=require",
        DATABASE_URL: "postgresql://db.example/crm_test",
      }),
    ).toThrow(
      "CRM_TEST_DATABASE_URL must not identify the same database as DATABASE_URL.",
    );
  });

  it("treats terminal DNS dots as the same database host identity", () => {
    expect(() =>
      crmTestDatabaseUrl({
        CRM_TEST_DATABASE_URL: "postgres://prod.example./crm_test",
        DATABASE_URL: "postgres://prod.example/crm_test",
      }),
    ).toThrow(
      "CRM_TEST_DATABASE_URL must not identify the same database as DATABASE_URL.",
    );
  });

  it("rejects a multihost DATABASE_URL before identity comparison", () => {
    expect(() =>
      crmTestDatabaseUrl({
        CRM_TEST_DATABASE_URL: "postgres://safe.example/crm_test",
        DATABASE_URL: "postgres://prod.example,other.example/crm",
      }),
    ).toThrow("DATABASE_URL must use exactly one URL authority host.");
  });

  it("allows a disposable test database distinct from DATABASE_URL", () => {
    const url = "postgres://database.example/crm_test";
    expect(
      crmTestDatabaseUrl({
        CRM_TEST_DATABASE_URL: url,
        DATABASE_URL: "postgres://database.example/crm",
      }),
    ).toBe(url);
  });

  it("fails closed when DATABASE_URL cannot be compared safely", () => {
    expect(() =>
      crmTestDatabaseUrl({
        CRM_TEST_DATABASE_URL: "postgres://database.example/crm_test",
        DATABASE_URL: "not-a-url",
      }),
    ).toThrow("DATABASE_URL must be a valid PostgreSQL URL.");
  });

  it("fails closed for release tests without the disposable database URL", () => {
    expect(() => crmTestDatabaseUrl({ CRM_RELEASE_TESTS: "1" })).toThrow(
      "CRM_TEST_DATABASE_URL must be set when CRM_RELEASE_TESTS=1.",
    );
  });

  it("remains optional outside release mode when no test URL is supplied", () => {
    expect(crmTestDatabaseUrl({ DATABASE_URL: "not-a-url" })).toBeUndefined();
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
      "tests/integration/act-migration-staging-migration.test.ts",
      "tests/integration/act-migration-snapshot-repository.test.ts",
      "tests/integration/act-migration-preview-repository.test.ts",
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
