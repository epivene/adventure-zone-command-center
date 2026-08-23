import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/components/navigation/app-menu.tsx",
  "src/components/today/next-call-card.tsx",
  "src/components/event-profiles/event-profile-workspace.tsx",
  "src/components/profiles/profile-detail-sheet.tsx",
  "src/components/profiles/simple-full-profile.tsx",
  "src/components/organizations/organization-list.tsx",
  "src/components/contacts/quick-add-caller.tsx",
  "src/pages/ContactDetailPage.tsx",
  "src/pages/OrganizationsPage.tsx",
];

const source = files.map((file) => `${file}\n${readFileSync(file, "utf8")}`).join("\n");

describe("canonical internal links", () => {
  it("does not generate retired caller or quick-add destinations", () => {
    expect(source).not.toContain('href="/quick-add"');
    expect(source).not.toContain("`/quick-add");
    expect(source).not.toContain('href="/calls/new');
    expect(source).not.toContain("`/calls/new?");
  });

  it("does not generate retired profile-detail destinations", () => {
    expect(source).not.toContain('href={`/event-profiles/${');
    expect(source).not.toContain('href="/organizations"');
    expect(source).not.toContain('href={`/organizations/${');
  });

  it("keeps canonical creation and edit routes where they are still real", () => {
    expect(source).toContain('href="/event-profiles/new"');
    expect(source).toContain('href={`/event-profiles/${profile.id}/edit`}');
  });
});
