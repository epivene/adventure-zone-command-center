import { describe, expect, it } from "vitest";

import { buildGoogleScopePreview } from "./google-scope-service";

describe("Google Workspace excluded label review", () => {
  it("returns excluded label names and types without adding them to approved scope", () => {
    const preview = buildGoogleScopePreview(
      [
        { id: "shows", name: "Shows", type: "user" },
        { id: "receipt", name: "Receipt", type: "user" },
        { id: "off-season", name: "Off Season Business Opportunities", type: "user" },
        { id: "employees", name: "Employees", type: "user" },
        { id: "associations", name: "Associations", type: "user" },
        { id: "SPAM", name: "SPAM", type: "system" },
        { id: "personal", name: "Personal/Family", type: "user" },
        { id: "TRASH", name: "TRASH", type: "system" },
      ],
      [
        { id: "az", summary: "Adventure Zone Calendar", primary: false },
        { id: "pirates", summary: "Pirate's Rebellion Calendar", primary: false },
        { id: "warriors", summary: "Warrior's Playground Calendar", primary: false },
        {
          id: "zone.pirate.warrior@gmail.com",
          summary: "Zone Pirate Warrior",
          primary: true,
        },
      ],
    );

    expect(preview.excludedLabels).toEqual([
      { id: "receipt", name: "Receipt", type: "user" },
      { id: "SPAM", name: "SPAM", type: "system" },
      { id: "personal", name: "Personal/Family", type: "user" },
      { id: "TRASH", name: "TRASH", type: "system" },
    ]);
    expect(preview.labels.some((label) => label.id === "receipt")).toBe(false);
    expect(preview.labels.some((label) => label.id === "SPAM")).toBe(false);
    expect(preview.labels.some((label) => label.id === "personal")).toBe(false);
    expect(preview.labels.some((label) => label.id === "TRASH")).toBe(false);
  });
});
