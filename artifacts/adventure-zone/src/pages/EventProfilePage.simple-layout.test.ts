import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const simple = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

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
