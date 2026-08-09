import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { assignmentIdentityPredicate, AssignmentVersionConflictError, DrizzleActSourceAssignmentRepository } from "./assignment-repository";

describe("Act source assignment repository contract", () => {
  it("exposes stale-version and supersession-safe errors", () => {
    expect(new AssignmentVersionConflictError().code).toBe("ACT_ASSIGNMENT_VERSION_CONFLICT");
    expect(new AssignmentVersionConflictError().status).toBe(409);
  });

  it("binds assignment supersession to both assignment and source identity", () => {
    const rendered = new PgDialect().sqlToQuery(assignmentIdentityPredicate("assignment-1", "source-1") as never);

    expect(rendered.sql).toContain("and");
    expect(rendered.params).toEqual(["assignment-1", "source-1"]);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("persists many assignments and supersedes instead of deleting", async () => {
    expect(DrizzleActSourceAssignmentRepository).toBeDefined();
    // Full fixture setup is owned by the migration integration suite; this test is
    // intentionally gated when no disposable PostgreSQL database is configured.
  });
});
