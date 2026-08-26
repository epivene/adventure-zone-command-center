import { describe, expect, it } from "vitest";

import { calculatePackageAvailability } from "./package-availability";

describe("calculatePackageAvailability", () => {
  const packages = [
    { code: "adventure_zone", name: "Adventure Zone", normalCapacity: 5, temporaryUnavailableQuantity: 1 },
    { code: "pirates_rebellion", name: "Pirate's Rebellion", normalCapacity: 3, temporaryUnavailableQuantity: 0 },
    { code: "warriors_playground", name: "Warrior's Playground", normalCapacity: 1, temporaryUnavailableQuantity: 1 },
    { code: "mini_zone", name: "Mini Zone", normalCapacity: 0, temporaryUnavailableQuantity: 0 },
  ];

  it("subtracts explicit reservations and maintenance without selling restricted capacity", () => {
    expect(calculatePackageAvailability({
      packages,
      reservations: [{ confidence: "explicit", packages: [
        { packageKey: "adventure_zone", quantity: 2 },
        { packageKey: "pirates_rebellion", quantity: 3 },
      ] }],
    })).toEqual({
      status: "resolved",
      packages: [
        { packageKey: "adventure_zone", normalCapacity: 5, bookedQuantity: 2, temporaryUnavailableQuantity: 1, availableQuantity: 2 },
        { packageKey: "pirates_rebellion", normalCapacity: 3, bookedQuantity: 3, temporaryUnavailableQuantity: 0, availableQuantity: 0 },
        { packageKey: "warriors_playground", normalCapacity: 1, bookedQuantity: 0, temporaryUnavailableQuantity: 1, availableQuantity: 0 },
        { packageKey: "mini_zone", normalCapacity: 0, bookedQuantity: 0, temporaryUnavailableQuantity: 0, availableQuantity: 0 },
      ],
      restrictedOptions: [
        { packageKey: "pirates_rebellion_restricted_fourth_unit", name: "Pirate's Rebellion restricted fourth unit", approvalRequired: true, reason: "Massive pool; requires extremely flat ground." },
        { packageKey: "mini_zone", name: "Mini Zone", approvalRequired: true, reason: "Last-resort / Dave approval only; estimated $5,000–$6,000 with final price set by Dave." },
      ],
      blockers: [],
    });
  });

  it("sums distinct explicit reservations, clamps maintenance, and fails closed on ambiguity", () => {
    expect(calculatePackageAvailability({
      packages: [{ code: "adventure_zone", name: "Adventure Zone", normalCapacity: 5, temporaryUnavailableQuantity: 9 }],
      reservations: [
        { confidence: "explicit", packages: [{ packageKey: "adventure_zone", quantity: 2 }] },
        { confidence: "explicit", packages: [{ packageKey: "adventure_zone", quantity: 1 }] },
        { confidence: "ambiguous", packages: [], evidence: ["ambiguous Calendar package usage"] },
      ],
    })).toMatchObject({
      status: "unresolved",
      packages: [{ packageKey: "adventure_zone", bookedQuantity: 3, availableQuantity: 0 }],
      blockers: ["ambiguous Calendar package usage"],
    });
  });
});
