import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("canonical Design Studio email repository", () => {
  it("scopes profile links to the account and active contact", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/features/office/office-email-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      "eq(designProjects.officeAccountId, input.accountId)",
    );
    expect(source).toContain("eq(organizationContacts.active, true)");
    expect(source).toContain("normalizeSendableContactEmail(row.email)");
  });

  it("locks one HTML row by project and retains Gmail identity", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/features/office/office-email-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      ".where(eq(officeEmailDrafts.designProjectId, input.projectId))",
    );
    expect(source).toContain('.for("update")');
    expect(source).toContain('bodyFormat: "html"');
    expect(source).not.toContain("gmailDraftId: null");
    expect(source).toContain('throw new OfficeEmailError("INVALID_STATE")');
  });

  it("claims due work with skip-locked leases and a deterministic send key", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/features/office/office-email-repository.ts",
      ),
      "utf8",
    );
    expect(source).toContain('.for("update", { skipLocked: true })');
    expect(source).toContain(
      "scheduled:${candidate.id}:${candidate.designVersionId",
    );
    expect(source).toContain("dispatchLeaseExpiresAt");
    expect(source).toContain("dispatchAttemptCount");
    expect(source).toContain(
      "eq(officeEmailDrafts.dispatchLeaseOwner, input.workerId)",
    );
  });
});
