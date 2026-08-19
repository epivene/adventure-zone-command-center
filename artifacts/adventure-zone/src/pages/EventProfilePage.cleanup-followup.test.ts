import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const simple = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");
const actions = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");
const timeline = readFileSync("src/components/activities/activity-timeline.tsx", "utf8");

describe("full profile cleanup", () => {
  it("uses one assistant entry point and exits inline edit from Back", () => {
    expect(page).toContain("profileEditing");
    expect(page).toContain("Back to profile");
    expect(page).not.toContain("DerivedFactsReview");
    expect(simple).toContain("Ask Assistant");
  });

  it("keeps ACT history collapsed, searchable and compact", () => {
    expect(page).toContain("Imported ACT history");
    expect(page).toContain("Search imported ACT history");
    expect(page).toContain("max-h-96 overflow-y-auto");
    expect(page).toContain("ACT_PREVIEW_LENGTH");
  });

  it("makes notes searchable, addable and collapses long bodies", () => {
    expect(simple).toContain("Search notes & history");
    expect(simple).toContain("createActivityAction");
    expect(simple).toContain("Add note");
    expect(simple).toContain("collapseLongBodies");
    expect(timeline).toContain("...more");
    expect(timeline).toContain("Show less");
  });

  it("removes redundant full-profile action and separates note from follow-up", () => {
    expect(actions).not.toContain("Open Full Profile");
    expect(actions).toContain("onAddNote");
    expect(actions).toContain(">Note<");
    expect(actions).toContain(">Follow-up<");
  });
});
