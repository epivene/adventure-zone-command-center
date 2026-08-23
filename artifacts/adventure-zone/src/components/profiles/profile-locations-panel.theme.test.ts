import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/profile-locations-panel.tsx", "utf8");

describe("ProfileLocationsPanel theme surfaces", () => {
  it("uses semantic theme classes instead of fixed light-only surfaces", () => {
    expect(source).toContain("bg-card");
    expect(source).toContain("bg-muted");
    expect(source).toContain("text-foreground");
    expect(source).toContain("text-muted-foreground");
    expect(source).not.toContain("bg-sky-50");
  });
});
