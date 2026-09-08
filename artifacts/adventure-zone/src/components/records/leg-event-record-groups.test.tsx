import { describe, expect, it } from "vitest";
import { groupRecordsByLegAndEvent } from "./leg-event-record-groups";

describe("leg and event record grouping", () => {
  it("keeps records with snapshot names but no links in unassigned groups", () => {
    const groups = groupRecordsByLegAndEvent([
      {
        id: "legacy-receipt",
        legId: null,
        legName: "Old Hulk label",
        bookingId: null,
        bookingName: "Old Fair label",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Unassigned leg");
    expect(groups[0]?.events).toHaveLength(1);
    expect(groups[0]?.events[0]?.name).toBe("Unassigned event");
  });
});
