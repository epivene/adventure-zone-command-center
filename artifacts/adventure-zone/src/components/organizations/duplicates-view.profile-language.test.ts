import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("duplicate review profile language", () => {
  it("explains the four relationship choices without organization jargon", () => {
    const source = readFileSync(new URL("./duplicates-view.tsx", import.meta.url), "utf8");

    expect(source).toContain("Combine as Profile Locations");
    expect(source).toContain("Same profile entered more than once");
    expect(source).toContain("One profile with multiple venues or addresses");
    expect(source).toContain("Related profiles that should keep separate history");
    expect(source).toContain("Profile names match after removing location suffixes");
    expect(source).toContain("ACT records connect these profiles");
    expect(source).toContain("Selected profiles marked as not related");
    expect(source).not.toContain("Organization locations");
    expect(source).not.toContain("Selected organizations marked as not related");
  });
});
