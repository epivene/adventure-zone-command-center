import { describe, expect, it } from "vitest";

import { buildGoogleScopePreview } from "./google-scope-service";

const labels = [
  { id: "shows", name: "Shows", type: "user" as const },
  { id: "receipt", name: "Receipt", type: "user" as const },
  {
    id: "off-season",
    name: "Off Season Business Opportunities",
    type: "user" as const,
  },
  { id: "employees", name: "Employees", type: "user" as const },
  { id: "associations", name: "Associations", type: "user" as const },
  { id: "SPAM", name: "SPAM", type: "system" as const },
];

describe("Google business calendar identity", () => {
  it("does not let the zone.pirate.warrior calendar stand in for a separately named calendar", () => {
    const preview = buildGoogleScopePreview(labels, [
      {
        id: "zone.pirate.warrior@gmail.com",
        summary: "Adventure Zone Calendar",
        primary: true,
      },
      {
        id: "pirates",
        summary: "Pirate's Rebellion Calendar",
        primary: false,
      },
      {
        id: "warriors",
        summary: "Warrior's Playground Calendar",
        primary: false,
      },
    ]);

    expect(preview.calendars.map((calendar) => calendar.id)).toEqual([
      "pirates",
      "warriors",
      "zone.pirate.warrior@gmail.com",
    ]);
    expect(preview.missingCalendars).toContain("Adventure Zone Calendar");
  });
});
