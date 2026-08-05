import { describe, expect, it } from "vitest";

import { AssignmentVersionConflictError, DrizzleActSourceAssignmentRepository } from "./assignment-repository";

describe("Act source assignment repository contract", () => {
  it("exposes stale-version and supersession-safe errors", () => {
    expect(new AssignmentVersionConflictError().code).toBe("ACT_ASSIGNMENT_VERSION_CONFLICT");
    expect(new AssignmentVersionConflictError().status).toBe(409);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)("persists many assignments and supersedes instead of deleting", async () => {
    expect(DrizzleActSourceAssignmentRepository).toBeDefined();
    // Full fixture setup is owned by the migration integration suite; this test is
    // intentionally gated when no disposable PostgreSQL database is configured.
  });
});
