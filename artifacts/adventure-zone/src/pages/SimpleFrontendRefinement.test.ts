import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dropdown = readFileSync("src/components/ui/dropdown-menu.tsx", "utf8");
const organizationList = readFileSync("src/components/organizations/organization-list.tsx", "utf8");
const profilesPage = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");
const profileSheet = readFileSync("src/components/profiles/profile-detail-sheet.tsx", "utf8");
const needsAttention = readFileSync("src/components/today/needs-attention.tsx", "utf8");

describe("simple frontend refinement contracts", () => {
  it("forces popup menus to use an opaque surface", () => {
    expect(dropdown).toContain("bg-white text-slate-950");
    expect(dropdown).toContain("z-[100]");
  });

  it("keeps profile search simple and advanced filters disclosed", () => {
    expect(organizationList).toContain("Search profiles, contacts, cities, phone, email");
    expect(organizationList).toContain("<details");
    expect(organizationList).toContain("Filters");
    expect(organizationList).toContain("Active filters");
  });

  it("keeps admin search controls above the Event Families dropdown", () => {
    const searchIndex = organizationList.indexOf("Search profiles, contacts, cities, phone, email");
    const insertionIndex = organizationList.indexOf("{afterSearch}");
    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(insertionIndex).toBeGreaterThan(searchIndex);
    expect(profilesPage).toContain("afterSearch={familySection}");
  });

  it("collapses event families and groups family/duplicate utilities at the bottom", () => {
    expect(profilesPage).toContain("<details");
    expect(profilesPage).toContain("Event Families");
    expect(profilesPage).toContain("<EventFamilySuggestions compact");
    expect(profilesPage).toContain("Find duplicates");
  });

  it("uses place identity and Notes instead of raw History as a main tab", () => {
    expect(profileSheet).toContain("data?.place?.name");
    expect(profileSheet).toContain('["overview", "notes", "events"]');
    expect(profileSheet).toContain("Open follow-ups");
    expect(profileSheet).toContain("followUpHistory");
    expect(profileSheet).toContain("History & imported changes");
  });

  it("keeps Today attention items in one compact action list instead of summary cards", () => {
    expect(needsAttention).not.toContain("SummaryCards");
    expect(needsAttention).toContain("Just the things that need a decision or follow-up.");
    expect(needsAttention).toContain("items.map");
  });
});
