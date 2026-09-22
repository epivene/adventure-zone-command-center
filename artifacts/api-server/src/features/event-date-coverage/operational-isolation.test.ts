import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const operationalSources = [
  "../../routes/calendar.ts",
  "../../routes/google-operational-calendar.ts",
  "../routes/map-data.ts",
  "../routes/route-view.ts",
  "../leg-manager/manager-map-booking-repository.ts",
  "../google-workspace/calendar/operational-calendar-projection-repository.ts",
] as const;

describe("event-date fact operational isolation", () => {
  it.each(operationalSources)("keeps researched facts out of %s", async (relativePath) => {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    expect(source).not.toMatch(/eventDateFacts|event_date_facts/);
    expect(source).toMatch(/booking|Booking/);
  });

  it("documents the booking boundary in the effective-date status contract", async () => {
    const source = await readFile(new URL("./event-date-types.ts", import.meta.url), "utf8");
    expect(source).toContain('"booked" | "confirmed" | "expected"');
    expect(source).not.toContain('EventDateDisplayStatus = "operational"');
  });
});
