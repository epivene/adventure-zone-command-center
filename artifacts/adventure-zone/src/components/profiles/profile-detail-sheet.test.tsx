// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");

describe("ProfileDetailSheet", () => {
  it("keeps the simple profile workspace and full-profile escape hatch", () => {
    expect(source).toContain('type Tab = "overview" | "notes" | "events"');
    expect(source).toContain("ProfileActionsMenu");
    expect(source).toContain("fullPageHref");
    expect(source).toContain("More profile details");
  });

  it("supports inline editing without leaving the drawer", () => {
    expect(source).toContain("ProfileInlineEditor");
    expect(source).toContain("setEditing(true)");
    expect(source).toContain("onSaved={handleInlineSaved}");
    expect(source).toContain('type="button">Edit</button>');
  });

  it("shows formatted phone, email, and website together", () => {
    expect(source).toContain("formatPhoneDisplay");
    expect(source).toContain("phoneHref");
    expect(source).toContain("normalizeExternalWebsite");
    expect(source).toContain("place.website");
  });
});
