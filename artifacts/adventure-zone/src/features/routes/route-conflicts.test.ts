import { describe, expect, it } from "vitest";
import { findSameLegDateConflicts, type RouteConflictEvent } from "./route-conflicts";

function event(id: string, start: string, end: string, legId = "leg-1"): RouteConflictEvent {
  return {
    id,
    name: id,
    status: "new_lead" as any,
    travelLegId: legId,
    travelLegName: "Leg 1",
    startsAt: new Date(`${start}T12:00:00Z`),
    endsAt: new Date(`${end}T12:00:00Z`),
  };
}

describe("findSameLegDateConflicts", () => {
  it("flags events separated by only one day because teardown and setup collide", () => {
    const conflicts = findSameLegDateConflicts([
      event("first", "2026-09-01", "2026-09-03"),
      event("second", "2026-09-05", "2026-09-06"),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlapFrom).toBe("2026-09-04");
    expect(conflicts[0]?.overlapTo).toBe("2026-09-04");
  });

  it("does not flag events with a full free day between teardown and setup", () => {
    const conflicts = findSameLegDateConflicts([
      event("first", "2026-09-01", "2026-09-03"),
      event("second", "2026-09-06", "2026-09-07"),
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it("does not compare events on different legs", () => {
    expect(findSameLegDateConflicts([
      event("first", "2026-09-01", "2026-09-03", "leg-1"),
      event("second", "2026-09-02", "2026-09-04", "leg-2"),
    ])).toHaveLength(0);
  });

  it("does not pad reserved operational windows a second time", () => {
    const first = {
      ...event("first", "2026-07-16", "2026-07-20"),
      actualStartsAt: new Date("2026-07-17T12:00:00Z"),
      actualEndsAt: new Date("2026-07-19T12:00:00Z"),
      operationalWindowSource: "google_calendar",
    };
    const second = {
      ...event("second", "2026-07-21", "2026-07-23"),
      actualStartsAt: new Date("2026-07-22T12:00:00Z"),
      actualEndsAt: new Date("2026-07-22T12:00:00Z"),
      operationalWindowSource: "google_calendar",
    };

    expect(findSameLegDateConflicts([first, second])).toHaveLength(0);
  });
});
