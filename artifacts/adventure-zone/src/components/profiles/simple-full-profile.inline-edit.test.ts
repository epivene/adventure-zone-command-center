import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

describe("SimpleFullProfile inline editing", () => {
  it("exposes Edit and the shared inline editor", () => {
    expect(source).toContain("ProfileInlineEditor");
    expect(source).toContain("setEditing(true)");
    expect(source).toContain("onEdit={() => setEditing(true)}");
    expect(source).toContain("onProfileSaved");
  });

  it("formats phone, opens guided calling, and keeps the website beside contact methods", () => {
    expect(source).toContain("formatPhoneDisplay");
    expect(source).toContain("callHref");
    expect(source).toContain("/calls/new?");
    expect(source).not.toContain("phoneHref");
    expect(source).toContain("websiteHref");
    expect(source).toContain("profile.place.website");
  });
});