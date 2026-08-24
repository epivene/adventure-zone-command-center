import { describe, expect, it } from "vitest";

import { buildGoogleScopePreview } from "./google-scope-service";

describe("Google Workspace corrected source names", () => {
  it("keeps the approved business roots and calendar names while excluding Receipt, Spam, Trash, and personal sources", () => {
    const preview = buildGoogleScopePreview(
      [
        { id: "shows", name: "Shows", type: "user" },
        { id: "receipt", name: "Receipt", type: "user" },
        { id: "off-season", name: "Off Season Business Opportunities", type: "user" },
        { id: "employees", name: "Employees", type: "user" },
        { id: "associations", name: "Associations", type: "user" },
        { id: "SPAM", name: "SPAM", type: "system" },
        { id: "TRASH", name: "TRASH", type: "system" },
        { id: "personal", name: "Personal", type: "user" },
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
        { id: "family", summary: "Family", primary: false },
      ],
    );

    expect(preview.labels.map((label) => label.id)).toEqual([
      "shows",
      "off-season",
      "employees",
      "associations",
    ]);
    expect(preview.labels.some((label) => label.id === "receipt")).toBe(false);
    expect(preview.labels.some((label) => label.id === "SPAM")).toBe(false);
    expect(preview.labels.some((label) => label.id === "TRASH")).toBe(false);
    expect(preview.labels.some((label) => label.id === "personal")).toBe(false);
    expect(preview.missingLabelRoots).toEqual([]);

    expect(preview.calendars.map((calendar) => calendar.id)).toEqual([
      "az",
      "pirates",
      "warriors",
      "zone.pirate.warrior@gmail.com",
    ]);
    expect(preview.missingCalendars).toEqual([]);
  });
});
