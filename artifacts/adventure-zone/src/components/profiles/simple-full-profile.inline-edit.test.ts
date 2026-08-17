import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

describe("SimpleFullProfile inline editing", () => {
  it("exposes Edit and the shared inline editor", () => {
    expect(source).toContain("ProfileInlineEditor");
    expect(source).toContain("setEditing(true)");
    expect(source).toContain('type="button">Edit</button>');
    expect(source).toContain("onProfileSaved");
  });

  it("formats phone and keeps website beside contact methods", () => {
    expect(source).toContain("formatPhoneDisplay");
    expect(source).toContain("phoneHref");
    expect(source).toContain("websiteHref");
    expect(source).toContain("profile.place.website");
  });
});
