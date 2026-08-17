import { describe, expect, it } from "vitest";

import { derivePackageHistoryComparison } from "./package-history";

function prior(input: {
  id: string;
  startsAt: string;
  total?: number | null;
  packages?: string[];
  specialResources?: Array<{ id: string; name: string }>;
}) {
  return {
    id: input.id,
    label: `Booking ${input.id}`,
    startsAt: new Date(input.startsAt),
    physicalAttractionTotal: input.total ?? null,
    packageNames: input.packages ?? [],
    specialResources: input.specialResources ?? [],
  };
}

describe("derivePackageHistoryComparison", () => {
  it("finds a repeated package mix and usual event month", () => {
    const result = derivePackageHistoryComparison({
      currentBookingId: "current",
      currentPhysicalAttractionTotal: 12,
      currentResourceIds: [],
      priorBookings: [
        prior({ id: "a", startsAt: "2025-07-10T12:00:00Z", total: 11, packages: ["Adventure Zone", "Pirate's Rebellion"] }),
        prior({ id: "b", startsAt: "2024-07-11T12:00:00Z", total: 12, packages: ["Pirate's Rebellion", "Adventure Zone"] }),
      ],
    });

    expect(result.signals).toContainEqual({
      kind: "usual_package_mix",
      packageNames: ["Adventure Zone", "Pirate's Rebellion"],
      sourceBookingIds: ["a", "b"],
    });
    expect(result.signals).toContainEqual({
      kind: "usual_event_month",
      month: 7,
      sampleBookingIds: ["a", "b"],
    });
  });

  it("compares the current total with the most recent prior total", () => {
    const result = derivePackageHistoryComparison({
      currentBookingId: "current",
      currentPhysicalAttractionTotal: 9,
      currentResourceIds: [],
      priorBookings: [
        prior({ id: "latest", startsAt: "2025-06-10T12:00:00Z", total: 12 }),
      ],
    });

    expect(result.signals).toContainEqual({
      kind: "main_attraction_difference",
      previousCount: 12,
      currentCount: 9,
      difference: -3,
      sourceBookingId: "latest",
    });
  });

  it("flags missing special shared equipment without flagging equipment already selected", () => {
    const result = derivePackageHistoryComparison({
      currentBookingId: "current",
      currentPhysicalAttractionTotal: null,
      currentResourceIds: ["generator"],
      priorBookings: [
        prior({
          id: "latest",
          startsAt: "2025-05-10T12:00:00Z",
          specialResources: [
            { id: "paintball", name: "Paintball trailer" },
            { id: "generator", name: "Generator" },
          ],
        }),
      ],
    });

    expect(result.signals).toContainEqual({
      kind: "missing_prior_resource",
      resourceId: "paintball",
      resourceName: "Paintball trailer",
      sourceBookingId: "latest",
    });
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({
        kind: "missing_prior_resource",
        resourceId: "generator",
      }),
    );
  });

  it("returns no signals when there is no history", () => {
    expect(
      derivePackageHistoryComparison({
        currentBookingId: "current",
        currentPhysicalAttractionTotal: 10,
        currentResourceIds: [],
        priorBookings: [],
      }),
    ).toEqual({ currentBookingId: "current", signals: [], sources: [] });
  });
});
