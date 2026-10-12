import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const simple = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");
const actions = readFileSync("src/components/profiles/profile-actions-menu.tsx", "utf8");
const workspace = readFileSync("src/components/profiles/festival-profile-workspace.tsx", "utf8");

describe("modern CRM full profile", () => {
  it("groups advanced tools under the existing profile disclosure", () => {
    expect(page).toContain("<SimpleFullProfile");
    expect(page).toContain("<EventProfileWorkspace");
    expect(page).not.toContain("More profile tools");
    expect(workspace).toContain("Activity, records &amp; profile tools");
  });

  it("keeps recent activity prominent and removes the duplicate follow-up action", () => {
    const compactActionsStart = simple.indexOf(
      "ProfileActionsMenu profileId={profile.id} contactId={primaryContact?.id} showAddNote={false} showFollowUp={false}",
    );
    const compactActionsEnd = simple.indexOf("onAssistant=", compactActionsStart);
    expect(compactActionsStart).toBeGreaterThan(-1);
    expect(simple.slice(compactActionsStart, compactActionsEnd)).toContain("callHref={callHref}");
    expect(workspace).toContain("<ProfileLatestNote");
    expect(workspace).toContain("<ProfileLatestEmail");
    expect(workspace).toContain(">Schedule follow-up</Button>");
  });

  it("uses the profile workspace header and grouped actions", () => {
    expect(simple).toContain("Adventure Zone");
    expect(simple).toContain("Relationships / {originLabel}");
    expect(page).toContain("originLabel={profileOrigin}");
    expect(simple).toContain("<ProfileWorkspaceActions");
    expect(simple).toContain("onAssistant={onAskAssistant");
    expect(simple).toContain("Open notifications");
    expect(simple).toContain("Open primary contact");
    expect(simple).not.toContain("profileImageDataUrl");
    expect(simple).not.toContain('["overview", "notes", "events"]');
  });

  it("groups profile destinations while preserving their deep-link section keys", () => {
    expect(simple).toContain('export type OpenSection = "contacts" | "events" | "notes" | "emails" | "documents" | null');
    expect(simple).toContain("useState<OpenSection>(() =>");
    expect(simple).toContain('label: "Overview"');
    expect(simple).toContain('label: "Activity"');
    expect(simple).toContain('label: "Records"');
    expect(simple).toContain('openSection === "contacts"');
    expect(simple).toContain('openSection === "events"');
    expect(simple).toContain('openSection === "notes"');
    expect(simple).toContain('const recordsOpen = ["contacts", "events", "documents"]');
    expect(simple).toContain('const activityOpen = ["notes", "emails"]');
    expect(simple).toContain("onClick={() => setOpenSection(section)}");
    expect(simple).toContain('document.getElementById("profile-section-content")?.scrollIntoView');
  });

  it("opens notes automatically when Add note is used", () => {
    expect(simple).toContain('setOpenSection("notes")');
    expect(simple).toContain("setNoteComposerOpen(true)");
  });

  it("keeps notes searchable and addable when the Notes card is open", () => {
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
    expect(page).toContain("DerivedFactsReview");
  });

  it("keeps the More menu wired to real actions", () => {
    expect(actions).toContain("Add note");
    expect(actions).toContain("Add follow-up");
    expect(actions).toContain("Add event");
    expect(actions).not.toContain("Open Full Profile");
    expect(actions).not.toContain("DropdownMenuSub");
    expect(actions).not.toContain("Status");
    expect(actions).not.toContain("Add to Organization");
    expect(actions).toContain("Add to Event Family");
    expect(actions).toContain('triggerLabel = "Actions"');
    expect(actions).toContain("More <ChevronDown");
  });

  it("shows recent activity before secondary festival and profile details", () => {
    const activityPosition = workspace.indexOf("<ProfileLatestNote");
    const editionPosition = workspace.indexOf("Festival edition");
    expect(activityPosition).toBeGreaterThan(-1);
    expect(activityPosition).toBeLessThan(editionPosition);
    expect(workspace).toContain("<ProfileLatestEmail");
    expect(workspace).toContain("Next action");
    expect(workspace).toContain("Organizer contact");
    expect(workspace).toContain("Activity, records &amp; profile tools");
  });

  it("keeps the three approved CRM metrics and relationship cards", () => {
    expect(simple).toContain("Contacts");
    expect(simple).toContain("Bookings & opportunities");
    expect(simple).toContain("Emails");
    expect(simple).toContain("No open follow-ups");
    expect(simple).toContain("Relationship health");
    expect(simple).toContain("Recent history");
    expect(simple).toContain("Organization record");
  });

  it("sanitizes imported ACT bodies before the profile surface receives them", () => {
    expect(page).toContain("note.importedFromAct ? simplifyHistoryText");
  });
});
