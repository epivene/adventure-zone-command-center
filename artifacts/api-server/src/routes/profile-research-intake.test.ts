import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = fs.readFileSync(path.resolve(__dirname, "profile-research-intake.ts"), "utf8");
const index = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf8");

describe("Source Scout prospect intake context", () => {
  it("persists public source and discovered dates only after lead creation", () => {
    expect(route).toContain("research-intake-context");
    expect(route).toContain("sourceUrl");
    expect(route).toContain("startsAt");
    expect(route).toContain("endsAt");
    expect(route).toContain("organizations.website");
    expect(route).toContain("bookings.startsAt");
  });

  it("is owner-authenticated through the normal route index", () => {
    expect(index).toContain("profileResearchIntakeRouter");
    expect(index.indexOf("router.use(requireOwnerMiddleware)")).toBeLessThan(index.indexOf("router.use(profileResearchIntakeRouter)"));
  });
});
