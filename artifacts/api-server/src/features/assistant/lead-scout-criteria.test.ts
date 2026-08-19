import { describe, expect, it } from "vitest";

import { interpretLeadDiscoveryCriteria } from "./lead-scout-criteria";

describe("interpretLeadDiscoveryCriteria", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("parses the approved Montana-to-Utah September example", () => {
    const result = interpretLeadDiscoveryCriteria(
      "I need to find an event between Montana and Utah in September 2026",
      now,
    );

    expect(result.kind).toBe("criteria");
    if (result.kind !== "criteria") return;
    expect(result.criteria.year).toBe(2026);
    expect(result.criteria.month).toBe(9);
    expect(result.criteria.dateFrom).toBe("2026-09-01");
    expect(result.criteria.dateThrough).toBe("2026-09-30");
    expect(result.criteria.geoMode).toBe("corridor");
    expect(result.criteria.regions).toEqual(["MT", "ID", "WY", "UT"]);
    expect(result.criteria.fitIntent).toBe("either");
    expect(result.summary).toMatch(/September 1–30, 2026/i);
    expect(result.summary).toMatch(/Montana.*Utah|MT.*UT/i);
  });

  it("does not invent a year when a seasonal request is ambiguous", () => {
    const result = interpretLeadDiscoveryCriteria(
      "find an event between Montana and Utah sometime this fall",
      now,
    );

    expect(result.kind).toBe("needs_clarification");
    if (result.kind !== "needs_clarification") return;
    expect(result.message).toMatch(/year|date/i);
    expect(result.partial.geoMode).toBe("corridor");
  });

  it("parses an explicit inclusive date range", () => {
    const result = interpretLeadDiscoveryCriteria(
      "Find family festivals in Idaho between June 10, 2027 and June 25, 2027",
      now,
    );

    expect(result.kind).toBe("criteria");
    if (result.kind !== "criteria") return;
    expect(result.criteria.dateFrom).toBe("2027-06-10");
    expect(result.criteria.dateThrough).toBe("2027-06-25");
    expect(result.criteria.year).toBe(2027);
    expect(result.criteria.month).toBe(6);
    expect(result.criteria.regions).toContain("ID");
    expect(result.criteria.eventKeywords).toEqual(expect.arrayContaining(["family", "festival"]));
  });

  it("parses a single state month and year", () => {
    const result = interpretLeadDiscoveryCriteria(
      "What fairs do we already know about in Idaho in August 2027?",
      now,
    );

    expect(result.kind).toBe("criteria");
    if (result.kind !== "criteria") return;
    expect(result.criteria.geoMode).toBe("regions");
    expect(result.criteria.regions).toEqual(["ID"]);
    expect(result.criteria.dateFrom).toBe("2027-08-01");
    expect(result.criteria.dateThrough).toBe("2027-08-31");
    expect(result.criteria.eventKeywords).toContain("fair");
  });

  it("preserves leg wording as leg-scoped intent", () => {
    const result = interpretLeadDiscoveryCriteria(
      "I need a family event near Leg 4 between June 10, 2027 and June 25, 2027",
      now,
    );

    expect(result.kind).toBe("criteria");
    if (result.kind !== "criteria") return;
    expect(result.criteria.geoMode).toBe("route");
    expect(result.criteria.legId).toBe("4");
    expect(result.criteria.dateFrom).toBe("2027-06-10");
    expect(result.criteria.dateThrough).toBe("2027-06-25");
  });

  it("detects explicit vendor opportunity intent", () => {
    const result = interpretLeadDiscoveryCriteria(
      "Find vendor opportunities at festivals in Utah in September 2027",
      now,
    );

    expect(result.kind).toBe("criteria");
    if (result.kind !== "criteria") return;
    expect(result.criteria.fitIntent).toBe("vendor_opportunity");
    expect(result.criteria.regions).toEqual(["UT"]);
    expect(result.criteria.eventKeywords).toContain("festival");
  });

  it("detects explicit entertainment booking intent", () => {
    const result = interpretLeadDiscoveryCriteria(
      "Find a fair in Wyoming in July 2027 that could book Adventure Zone as entertainment",
      now,
    );

    expect(result.kind).toBe("criteria");
    if (result.kind !== "criteria") return;
    expect(result.criteria.fitIntent).toBe("bookable_event");
    expect(result.criteria.regions).toEqual(["WY"]);
    expect(result.criteria.eventKeywords).toContain("fair");
  });

  it("requires useful date and geography instead of treating arbitrary chat as a scout request", () => {
    const result = interpretLeadDiscoveryCriteria("What should I work on today?", now);
    expect(result.kind).toBe("needs_clarification");
  });
});
