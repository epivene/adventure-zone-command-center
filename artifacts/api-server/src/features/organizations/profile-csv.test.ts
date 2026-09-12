import { describe, expect, it } from "vitest";

import { createProfileCsv } from "./profile-csv";

describe("createProfileCsv", () => {
  it("exports the decision columns and escapes commas, quotes, and newlines", () => {
    const csv = createProfileCsv([
      {
        eventName: 'Fair, "Fall"',
        location: "Denver, CO",
        nextDate: "",
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
      "Event name,Location,Next date,Deadline,Status,Recommended deal model,Next action,Contact name,Contact email,Contact phone",
    );
    expect(csv).toContain('"Fair, ""Fall"""');
    expect(csv).toContain('"Call\norganizer"');
  });

  it("neutralizes spreadsheet formulas in user-controlled values", () => {
    const csv = createProfileCsv([{
      eventName: "=HYPERLINK(\"https://example.test\")", location: "+Denver", nextDate: "",
      deadline: "", status: "Waiting", recommendedDealModel: "Either", nextAction: "@call",
      contactName: "-Jamie", contactEmail: "jamie@example.com", contactPhone: "  =1+1",
    }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+Denver");
    expect(csv).toContain("'@call");
    expect(csv).toContain("'-Jamie");
    expect(csv).toContain("'  =1+1");
  });
});
