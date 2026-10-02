import type { PlanningRead, PlanDraft } from "@workspace/api-zod";
export const planningIds = {
  booking: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  leg: "00000000-0000-4000-8000-000000000003",
  worker: "00000000-0000-4000-8000-000000000004",
  resource: "00000000-0000-4000-8000-000000000005",
  pkg: "00000000-0000-4000-8000-000000000006",
  set: "00000000-0000-4000-8000-000000000007",
};
export function planningFixture(id = planningIds.booking): PlanningRead {
  const draft: PlanDraft = {
    bookingId: id,
    legId: planningIds.leg,
    seasonYear: 2027,
    window: null,
    phases: {},
    requirements: {
      minimumCrew: null,
      roles: null,
      transportRequired: null,
      lodging: "unknown",
      lodgingReason: null,
    },
    crew: [],
    packageSetIds: [],
    transportResourceIds: [],
    lodging: [],
    splitGroupId: null,
  };
  const dimension = {
    state: "needs_details" as const,
    reasons: [
      {
        code: "MISSING_DETAILS",
        message: "Record actual staffing and equipment.",
        href: "/operations/legs",
      },
    ],
  };
  return {
    plan: {
      bookingId: id,
      revision: 1,
      draft,
      committed: null,
      invalidationReasons: [],
    },
    draft,
    actions: { edit: true, commit: true, request: true, decide: false },
    requests: [],
    decisions: [],
    readiness: {
      overall: "needs_details",
      dimensions: {
        crew: dimension,
        equipment: dimension,
        dates_travel: dimension,
        accommodation: dimension,
        approval: dimension,
      },
      evaluatedAt: "2026-10-02T00:00:00Z",
      factsFingerprint: "a".repeat(64),
    },
    catalog: {
      enabled: true,
      legs: [{ id: planningIds.leg, name: "Angel" }],
      workers: [
        {
          id: planningIds.worker,
          name: "Actual worker",
          rehireStatus: "rehirable",
        },
      ],
      resources: [
        {
          id: planningIds.resource,
          name: "Actual trailer",
          category: "Trailer",
          status: "available",
          minimumTransferMinutes: 0,
        },
      ],
      packages: [
        {
          id: planningIds.pkg,
          name: "Adventure Zone",
          code: "adventure_zone",
          normalCapacity: 5,
          unavailableQuantity: 0,
        },
      ],
      packageSets: [
        {
          id: planningIds.set,
          packageId: planningIds.pkg,
          name: "Actual AZ set",
          classification: "normal",
          state: "unverified",
          resourceIds: [planningIds.resource],
          requirements: { Trailer: 1 },
          source: null,
          verifiedBy: null,
          verifiedAt: null,
          revision: 1,
        },
      ],
      availability: [],
      bookings: [
        { id, name: "Fair", legId: planningIds.leg, seasonYear: 2027 },
        {
          id: planningIds.other,
          name: "Second fair",
          legId: planningIds.leg,
          seasonYear: 2027,
        },
      ],
    },
  };
}
