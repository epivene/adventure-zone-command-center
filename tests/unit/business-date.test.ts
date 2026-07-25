import { describe, expect, it } from "vitest";

import {
  BUSINESS_TIME_ZONE,
  businessDateKey,
  businessDayBounds,
  classifyBusinessDueDate,
  isFutureBusinessDate,
  parseBusinessDate,
} from "@/lib/business-date";

describe("Stage 1 business dates", () => {
  it("uses America/Chicago and stores date-only values at local noon", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Chicago");
    expect(parseBusinessDate("2026-03-08")?.toISOString()).toBe(
      "2026-03-08T17:00:00.000Z",
    );
    expect(parseBusinessDate("2026-11-01")?.toISOString()).toBe(
      "2026-11-01T18:00:00.000Z",
    );
  });

  it("changes business dates at Chicago midnight, not UTC midnight", () => {
    expect(businessDateKey(new Date("2026-08-04T04:59:59.999Z"))).toBe(
      "2026-08-03",
    );
    expect(businessDateKey(new Date("2026-08-04T05:00:00.000Z"))).toBe(
      "2026-08-04",
    );
  });

  it("produces DST-aware start and end boundaries", () => {
    const spring = businessDayBounds(new Date("2026-03-08T18:00:00.000Z"));
    expect(spring.start.toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-03-09T05:00:00.000Z");

    const fall = businessDayBounds(new Date("2026-11-01T18:00:00.000Z"));
    expect(fall.start.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(fall.end.toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("keeps tomorrow future through the prior Chicago evening", () => {
    const due = parseBusinessDate("2026-08-04");
    expect(due).not.toBeNull();

    expect(
      isFutureBusinessDate(
        due!,
        new Date("2026-08-04T04:59:59.999Z"),
      ),
    ).toBe(true);
    expect(
      isFutureBusinessDate(
        due!,
        new Date("2026-08-04T05:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("classifies overdue, due-today, and future by Chicago calendar date", () => {
    const now = new Date("2026-08-04T04:30:00.000Z");

    expect(
      classifyBusinessDueDate(parseBusinessDate("2026-08-02")!, now),
    ).toBe("overdue");
    expect(
      classifyBusinessDueDate(parseBusinessDate("2026-08-03")!, now),
    ).toBe("today");
    expect(
      classifyBusinessDueDate(parseBusinessDate("2026-08-04")!, now),
    ).toBe("future");
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(parseBusinessDate("2026-02-29")).toBeNull();
    expect(parseBusinessDate("08/03/2026")).toBeNull();
    expect(parseBusinessDate("")).toBeNull();
  });
});
