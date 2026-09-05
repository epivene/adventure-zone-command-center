import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { organizationListQuerySchema, setFillerInputSchema } from "./last-resort-input";

function readSource(relativePath: string) {
  const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
  return readFileSync(path.resolve(repositoryRoot, relativePath), "utf8");
}

const routeSource = readSource("artifacts/api-server/src/routes/organization-filler.ts");
const migrationSource = readSource("lib/db/migrations/20260829_profile_filler.sql");
const directorySource = readSource("artifacts/api-server/src/features/organizations/organization-directory-page.ts");

describe("filler profile strategy", () => {
  it("requires a reason when enabling filler", () => {
    expect(setFillerInputSchema.safeParse({ organizationId: "00000000-0000-4000-8000-000000000001", enabled: true, reason: "" }).success).toBe(false);
    expect(setFillerInputSchema.parse({ organizationId: "00000000-0000-4000-8000-000000000001", enabled: true, reason: "Between two stronger route bookings" }).enabled).toBe(true);
  });

  it("supports a filler-only profile directory filter and lowers filler in default priority", () => {
    expect(organizationListQuerySchema.parse({ filler: "only" }).filler).toBe("only");
    expect(directorySource).toMatch(/query\.filler === "only"/);
    expect(directorySource).toMatch(/filler = true/);
    expect(directorySource).toMatch(/case when .*filler.* then 1 else 0 end/);
  });

  it("persists filler separately from Last Resort and does not alter booking probability", () => {
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS filler boolean");
    expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS filler_reason text");
    expect(migrationSource).toContain("organizations_filler_reason_required");
    expect(migrationSource).toContain("IF NOT EXISTS (");
    expect(routeSource).toContain('router.post("/organizations/filler"');
    expect(routeSource).not.toMatch(/probability_auto_filler/);
  });
});
