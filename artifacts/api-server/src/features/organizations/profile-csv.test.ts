import { describe, expect, it } from "vitest";

import { createProfileCsv } from "./profile-csv";

describe("createProfileCsv", () => {
  it("exports the decision columns and escapes commas, quotes, and newlines", () => {
    const csv = createProfileCsv([
      {
        name: 'Fair, "Fall"',
        location: "Denver, CO",
        nextDate: null,
        deadline: null,
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
});
