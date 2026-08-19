// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");

describe("ProfileDetailSheet Option C", () => {
  it("keeps the side profile minimal with one full-profile escape hatch", () => {
    expect(source).toContain("fullPageHref");
    expect(source).not.toContain('type Tab = "overview" | "notes" | "events"');
    expect(source).not.toContain('role="tablist"');
    expect(source).toContain("No open follow-ups");
    expect(source).toContain("Follow-up overdue");
    expect(source).toContain("Follow-up needed");
  });

  it("shows each primary action only once", () => {
    expect(source.match(/>Edit<\/button>/g)?.length ?? 0).toBe(1);
    expect(source.match(/>Add note<\/button>/g)?.length ?? 0).toBe(1);
    expect(source.match(/ProfileActionsMenu/g)?.length ?? 0).toBe(2); // import + one render
    expect(source).toContain("showAddNote={false}");
    expect(source).not.toContain("Open full profile");
  });

  it("moves address and category into the identity card", () => {
    expect(source).toContain("fullAddress");
    expect(source).toContain("place.placeType");
    expect(source).not.toContain("More details");
    expect(source).not.toContain('detailSection === "details"');
  });

  it("does not repeat the recent note in the notes drawer", () => {
    expect(source).toContain("const olderNotes = meaningfulNotes.slice(1)");
    expect(source).toContain('detailRow("Note history", olderNotes.length');
    expect(source).toContain("olderNotes.map");
    expect(source).not.toContain('detailRow("Notes", meaningfulNotes.length');
  });

  it("uses quick contact actions and compact counts", () => {
    expect(source).toContain("phoneHref");
    expect(source).toContain("mailto:");
    expect(source).toContain("websiteHref");
    expect(source).toContain("contacts.length");
    expect(source).toContain("bookings.length");
  });

  it("supports inline editing and a working note composer", () => {
    expect(source).toContain("ProfileInlineEditor");
    expect(source).toContain("createActivityAction");
    expect(source).toContain("Save note");
    expect(source).toContain("onSaved={handleInlineSaved}");
  });
});
