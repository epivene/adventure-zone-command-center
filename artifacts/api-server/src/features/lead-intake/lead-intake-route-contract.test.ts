import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../routes/lead-intake.ts", import.meta.url), "utf8");

describe("lead intake review route contract", () => {
  it("exposes profile contacts and one versioned confirmation mutation", () => {
    expect(source).toContain('router.get("/lead-intake/organizations/:organizationId/contacts"');
    expect(source).toContain('router.post("/lead-intake/rows/:rowId/confirm"');
    expect(source).toContain("leadReviewConfirmationSchema.safeParse");
    expect(source).toContain('error.code === "VERSION_CONFLICT"');
    expect(source).toContain('error.code === "REVIEW_BLOCKED"');
  });
});
