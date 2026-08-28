import { describe, expect, it } from "vitest";

import { renderOperationalCalendarRows } from "./operational-calendar-renderer";

const base = {
  managerName: "Mikey",
  eventName: "Blanding City Fall Festival",
  city: "Blanding",
  region: "UT",
  actualEventDateText: "Saturday, September 12th",
  reservedStart: new Date("2026-09-10T00:00:00Z"),
  reservedEnd: new Date("2026-09-14T00:00:00Z"),
  packages: ["zone"] as const,
  contactText: "Shauna 555-0100",
  addressText: "735 S 200 W Ste 1",
  attractionText: "Adventure Zone",
  paymentInfo: "PrePaid $9,000",
  invoiceSent: "August 24, 2026",
  contractSigned: "Pending",
  depositReceived: "Pending",
  amountDue: "$9,000",
};

describe("renderOperationalCalendarRows", () => {
  it("renders the familiar manager-first Blanding calendar format", () => {
    const [row] = renderOperationalCalendarRows(base);
    expect(row?.summary).toBe("MIKEY Blanding City Fall Festival - Blanding UT (Zone)");
    expect(row?.description).toContain("EVENT DATES: Saturday, September 12th");
    expect(row?.description).toContain("PAYMENT INFO: PrePaid $9,000");
    expect(row?.description).toContain("CONTRACT SIGNED: Pending");
    expect(row?.reservedStart).toEqual(new Date("2026-09-10T00:00:00Z"));
    expect(row?.reservedEnd).toEqual(new Date("2026-09-14T00:00:00Z"));
  });

  it("creates one familiar Google row per package without changing the CRM event identity", () => {
    const rows = renderOperationalCalendarRows({
      ...base,
      packages: ["zone", "pirates", "warrior"],
    });
    expect(rows.map((row) => row.summary)).toEqual([
      "MIKEY Blanding City Fall Festival - Blanding UT (Zone)",
      "MIKEY Blanding City Fall Festival - Blanding UT (Pirates)",
      "MIKEY Blanding City Fall Festival - Blanding UT (Warrior)",
    ]);
  });

  it("does not invent unknown contact or payment fields", () => {
    const [row] = renderOperationalCalendarRows({
      ...base,
      contactText: null,
      addressText: null,
      paymentInfo: null,
      invoiceSent: null,
      contractSigned: null,
      depositReceived: null,
      amountDue: null,
    });
    expect(row?.description).not.toContain("CONTACT:");
    expect(row?.description).not.toContain("PAYMENT INFO:");
    expect(row?.description).toContain("EVENT DATES: Saturday, September 12th");
  });
});
