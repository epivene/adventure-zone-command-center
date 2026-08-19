import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const simple = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");
const actions = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");

describe("compact full profile", () => {
  it("uses the compact profile surface before advanced tools", () => {
    expect(page).toContain("<SimpleFullProfile");
    expect(page).toContain("Advanced profile tools");
    expect(page.indexOf("<SimpleFullProfile")).toBeLessThan(page.indexOf("Advanced profile tools"));
  });

  it("uses the approved compact header and timeline instead of the old tab strip", () => {
    expect(simple).toContain("Activity timeline");
    expect(simple).toContain("About");
    expect(simple).toContain("Ask Assistant");
    expect(simple).toContain("profileImageDataUrl");
    expect(simple).not.toContain('["overview", "notes", "events"]');
  });

  it("makes the summary cards useful shortcuts to real profile sections", () => {
    expect(simple).toContain('targetId="profile-contacts"');
    expect(simple).toContain('targetId="profile-events"');
    expect(simple).toContain('targetId="profile-activity-timeline"');
    expect(simple).toContain('id="profile-contacts"');
    expect(simple).toContain('id="profile-events"');
    expect(simple).toContain('id="profile-activity-timeline"');
    expect(simple).toContain("scrollIntoView");
  });

  it("keeps notes searchable and addable from the compact profile", () => {
    expect(simple).toContain("Search notes & history");
    expect(simple).toContain("Add note");
    expect(simple).toContain("createActivityAction");
    expect(simple).toContain("filteredActivities");
  });

  it("keeps imported ACT history collapsed, scrollable, truncated, and expandable", () => {
    expect(page).toContain("Imported ACT history");
    expect(page).toContain("max-h-96");
    expect(page).toContain("overflow-y-auto");
    expect(page).toContain("More");
    expect(page).toContain("Less");
    expect(page).not.toContain("DerivedFactsReview");
  });

  it("keeps Actions flat and limited to things that actually do something", () => {
    expect(actions).toContain("Add note");
    expect(actions).toContain("Add follow-up");
    expect(actions).toContain("Add event");
    expect(actions).not.toContain("Open Full Profile");
    expect(actions).not.toContain("DropdownMenuSub");
    expect(actions).not.toContain("Status");
    expect(actions).not.toContain("Add to Organization");
    expect(actions).not.toContain("Add to Event Family");
    expect(actions).not.toContain("Archive / Delete");
    expect(actions).not.toContain(">More<");
  });

  it("shows only contact, event and note stat cards plus one color-coded follow-up card", () => {
    expect(simple).toContain("Contact");
    expect(simple).toContain("Events");
    expect(simple).toContain("Note");
    expect(simple).toContain("No open follow-ups");
    expect(simple).toContain("Follow-up overdue");
    expect(simple).toContain("Follow-up needed");
    expect(simple).toContain("bg-emerald-50");
    expect(simple).toContain("bg-rose-50");
    expect(simple).toContain("bg-amber-50");
  });

  it("sanitizes imported ACT bodies before the profile surface receives them", () => {
    expect(page).toContain("note.importedFromAct ? simplifyHistoryText");
  });
});
