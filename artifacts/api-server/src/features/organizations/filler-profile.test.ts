import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { organizationListQuerySchema, setFillerInputSchema } from "./last-resort-input";

// RED: the Filler strategy does not exist yet.
const routeSource = readFileSync(new URL("../../routes/organizations.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../../../../../lib/db/src/schema/index.ts", import.meta.url), "utf8");
const directorySource = readFileSync(new URL("./organization-directory-page.ts", import.meta.url), "utf8");

describe("filler profile strategy", () => {
  it("requires a reason when enabling filler", () => {
    expect(setFillerInputSchema.safeParse({ organizationId: "00000000-0000-4000-8000-000000000001", enabled: true, reason: "" }).success).toBe(false);
    expect(setFillerInputSchema.parse({ organizationId: "00000000-0000-4000-8000-000000000001", enabled: true, reason: "Between two stronger route bookings" }).enabled).toBe(true);
  });

  it("supports a filler-only profile directory filter", () => {
    expect(organizationListQuerySchema.parse({ filler: "only" }).filler).toBe("only");
    expect(directorySource).toMatch(/query\.filler === "only"/);
    expect(directorySource).toMatch(/organizations\.filler/);
  });

  it("persists filler separately from Last Resort and does not alter booking probability", () => {
    expect(schemaSource).toMatch(/filler: boolean\("filler"\)/);
    expect(schemaSource).toMatch(/fillerReason: text\("filler_reason"\)/);
    expect(routeSource).toContain('router.post("/organizations/filler"');
    expect(routeSource).not.toMatch(/probability_auto_filler/);
  });
});
