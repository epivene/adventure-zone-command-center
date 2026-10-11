import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createProfileCsv } from "./profile-csv";

const exportRouteSource = readFileSync("src/routes/organizations.ts", "utf8");

describe("createProfileCsv", () => {
  it("exports the decision columns and escapes commas, quotes, and newlines", () => {
    const csv = createProfileCsv([
      {
        eventName: 'Fair, "Fall"',
        location: "Denver, CO",
        nextDate: "",
        nextEventStatus: "No upcoming date; latest recorded date below",
        latestRecordedEventDate: "2025-06-10",
        latestRecordedEventEndDate: "2025-06-12",
        latestRecordedEventSource: "Festival edition",
        deadline: "",
        status: "Waiting",
        recommendedDealModel: "Either",
        nextAction: "Call\norganizer",
        contactName: "Jamie Rivers",
        contactEmail: "jamie@example.com",
        contactPhone: "555-0100",
      },
    ]);
    expect(csv).toContain(
      "Event name,Location,Next event date,Next event status,Latest recorded event date,Latest recorded event end date,Latest recorded date source,Deadline,Status,Recommended deal model,Next action,Contact name,Contact email,Contact phone",
    );
    expect(csv).toContain('"Fair, ""Fall"""');
    expect(csv).toContain('"Call\norganizer"');
    expect(csv).toContain("2025-06-10,2025-06-12,Festival edition");
  });

  it("neutralizes spreadsheet formulas in user-controlled values", () => {
    const csv = createProfileCsv([
      {
        eventName: '=HYPERLINK("https://example.test")',
        location: "+Denver",
        nextDate: "",
        nextEventStatus: "Date not found",
        latestRecordedEventDate: "",
        latestRecordedEventEndDate: "",
        latestRecordedEventSource: "",
        deadline: "",
        status: "Waiting",
        recommendedDealModel: "Either",
        nextAction: "@call",
        contactName: "-Jamie",
        contactEmail: "jamie@example.com",
        contactPhone: "  =1+1",
      },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+Denver");
    expect(csv).toContain("'@call");
    expect(csv).toContain("'-Jamie");
    expect(csv).toContain("'  =1+1");
  });

  it("exports the latest recorded date and avoids calling a saved past date missing", () => {
    expect(exportRouteSource).toContain("record.latestRecordedEventDate?.startsOn");
    expect(exportRouteSource).toContain("record.latestRecordedEventDate?.endsOn");
    expect(exportRouteSource).toContain("record.latestRecordedEventDate.source");
    expect(exportRouteSource).toContain("No upcoming date; latest recorded date below");
  });
});
