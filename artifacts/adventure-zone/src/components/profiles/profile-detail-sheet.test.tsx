// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/components/profiles/profile-detail-sheet.tsx",
  "utf8",
);

describe("ProfileDetailSheet Option C", () => {
  it("keeps the side profile minimal with one full-profile escape hatch", () => {
    expect(source).toContain("fullPageHref");
    expect(source).not.toContain('type Tab = "overview" | "notes" | "events"');
    expect(source).not.toContain('role="tablist"');
    expect(source).toContain("No open follow-up records");
    expect(source).toContain("Follow-up overdue");
    expect(source).toContain("Follow-up needed");
  });

  it("shows each primary action only once", () => {
    expect(source.match(/>\s*Edit\s*<\/button>/g)?.length ?? 0).toBe(1);
    expect(source.match(/>\s*Add note\s*<\/button>/g)?.length ?? 0).toBe(1);
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

  it("keeps only the recent-note preview instead of redundant note-history and event drawers", () => {
    expect(source).toContain("Recent note");
    expect(source).not.toContain('detailRow("Note history"');
    expect(source).not.toContain('detailRow("Events"');
    expect(source).not.toContain("olderNotes.map");
  });

  it("shows a newly saved note immediately while the server refresh catches up", () => {
    expect(source).toContain("optimisticRecentNote");
    expect(source).toContain("setOptimisticRecentNote(result.activity)");
    expect(source).toContain(
      "const recentNote = optimisticRecentNote ?? meaningfulNotes[0] ?? null",
    );
  });

  it("uses guided calling plus the remaining quick contact actions", () => {
    expect(source).toContain("callHref");
    expect(source).toContain("/calls/workspace?");
    expect(source).not.toContain("phoneHref");
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

  it("keeps profile actions in the scroll flow for the email summary", () => {
    expect(source).toContain('data-testid="profile-action-flow"');
    expect(source).not.toContain('className="sticky bottom-0');
    expect(source).toContain("border-[#d8d1c4]");
    expect(source).toContain("bg-[#fffefa]");
    expect(source).toContain("ProfileEmailSummary");
    expect(source).not.toMatch(/(?:slate|emerald|rose|amber)-/);
  });
});
