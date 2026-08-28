import { describe, expect, it } from "vitest";

import { parseDavidOperationalCalendarEvent } from "./david-calendar-parser";

describe("parseDavidOperationalCalendarEvent", () => {
  it("parses manager, location, and Zone package from a normal operational row", () => {
    expect(parseDavidOperationalCalendarEvent({
      summary: "KRISTY Eastern Montana Fair - Miles City MT (Zone)",
    })).toMatchObject({
      managerToken: "KRISTY",
      eventName: "Eastern Montana Fair",
      city: "Miles City",
      region: "MT",
      packageKey: "zone",
      calendarState: "confirmed",
    });
  });

  it("parses Hulk and Pirates package variants", () => {
    expect(parseDavidOperationalCalendarEvent({
      summary: "HULK Millard County Fair - Delta UT (Pirates)",
    })).toMatchObject({
      managerToken: "HULK",
      eventName: "Millard County Fair",
      city: "Delta",
      region: "UT",
      packageKey: "pirates",
      calendarState: "confirmed",
    });
  });

  it("parses the approved Blanding example and labeled description fields", () => {
    const description = [
      "CONTACT: Shauna 555-0100",
      "EVENT DATES: Saturday, September 12th",
      "EVENT ADDRESS/MAILING: 735 S 200 W Ste 1",
      "ATTRACTION LIST: Adventure Zone",
      "ADDITIONAL INFO: City fall festival",
      "PAYMENT INFO: PrePaid $9,000",
      "INVOICE SENT: August 24, 2026",
      "CONTRACT SIGNED: Pending",
      "DEPOSIT RECEIVED: Pending",
      "AMOUNT DUE UPON ARRIVAL: $9,000",
    ].join("\n");

    expect(parseDavidOperationalCalendarEvent({
      summary: "MIKEY Blanding City Fall Festival - Blanding UT (Zone)",
      description,
    })).toEqual({
      managerToken: "MIKEY",
      eventName: "Blanding City Fall Festival",
      city: "Blanding",
      region: "UT",
      packageKey: "zone",
      calendarState: "confirmed",
      actualEventDateText: "Saturday, September 12th",
      contactText: "Shauna 555-0100",
      addressText: "735 S 200 W Ste 1",
      attractionText: "Adventure Zone",
      additionalInfo: "City fall festival",
      paymentInfo: "PrePaid $9,000",
      invoiceSent: "August 24, 2026",
      contractSigned: "Pending",
      depositReceived: "Pending",
      amountDue: "$9,000",
      originalDescription: description,
    });
  });

  it.each([
    ["PLACEHOLDER Pirate Fest - Northglenn CO (Zone)", "placeholder"],
    ["CANCELLED Southern Ute Tribal Fair - Ignacio CO (Zone)", "cancelled"],
    ["NEED CONTACT & PH Some Festival - Casper WY (Zone)", "action_required"],
  ] as const)("keeps special calendar state for %s", (summary, calendarState) => {
    const parsed = parseDavidOperationalCalendarEvent({ summary });
    expect(parsed.calendarState).toBe(calendarState);
    expect(parsed.managerToken).toBeNull();
  });

  it("does not invent missing description fields", () => {
    const parsed = parseDavidOperationalCalendarEvent({
      summary: "DAVE Beaverhead County Fair - Dillon MT (Warrior)",
      description: "CONTACT: Amy",
    });
    expect(parsed.packageKey).toBe("warrior");
    expect(parsed.contactText).toBe("Amy");
    expect(parsed.actualEventDateText).toBeNull();
    expect(parsed.paymentInfo).toBeNull();
  });
});
