// Local test data only. These records are never imported by production startup.
import type {
  PlanDraft,
  PlanFacts,
  PlanningActor,
  PlanObligation,
  ApprovalDecision,
  WindowInput,
} from "@workspace/api-zod";
export const ids = {
  leg: "00000000-0000-4000-8000-000000000001",
  booking: "00000000-0000-4000-8000-000000000002",
  worker: "00000000-0000-4000-8000-000000000003",
  resource: "00000000-0000-4000-8000-000000000004",
  package: "00000000-0000-4000-8000-000000000005",
  set: "00000000-0000-4000-8000-000000000006",
  boss: "00000000-0000-4000-8000-000000000007",
  otherBooking: "00000000-0000-4000-8000-000000000008",
  split: "00000000-0000-4000-8000-000000000009",
};
export const fixtureWindow: WindowInput = {
  startsAt: "2027-07-21T12:00:00Z",
  endsAt: "2027-07-26T12:00:00Z",
  semantics: "timestamp",
  source: "operator-reviewed contract",
};
export const source = {
  label: "Confirmed with worker",
  href: "https://example.com/source",
};
export function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    bookingId: ids.booking,
    legId: ids.leg,
    seasonYear: 2027,
    window: { ...fixtureWindow },
    phases: {},
    requirements: {
      minimumCrew: 1,
      roles: { operator: 1 },
      transportRequired: false,
      lodging: "unnecessary",
      lodgingReason: "Local staff return home",
    },
    crew: [
      {
        workerId: ids.worker,
        role: "operator",
        window: { ...fixtureWindow },
        state: "confirmed",
      },
    ],
    packageSetIds: [ids.set],
    transportResourceIds: [],
    lodging: [],
    splitGroupId: null,
    ...overrides,
  };
}
export function completeFacts(overrides: Partial<PlanFacts> = {}): PlanFacts {
  return {
    draft: draft(),
    revision: 1,
    booking: {
      id: ids.booking,
      legId: ids.leg,
      status: "confirmed",
      seasonYear: 2027,
      window: { ...fixtureWindow },
      packageIds: [ids.package],
    },
    season: {
      legId: ids.leg,
      seasonYear: 2027,
      revision: 1,
      leadership: "confirmed",
      managerWorkerId: ids.worker,
      managerName: "Fixture manager",
      workerIds: [ids.worker],
      baseAddress: null,
      transportResourceIds: [],
    },
    workers: [
      { id: ids.worker, name: "Fixture worker", rehireStatus: "rehirable" },
    ],
    availability: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        workerId: ids.worker,
        window: { ...fixtureWindow },
        state: "confirmed",
        source,
        revision: 1,
      },
    ],
    packageSets: [
      {
        id: ids.set,
        packageId: ids.package,
        name: "Fixture Pirates set",
        classification: "normal",
        resourceIds: [ids.resource],
        requirements: { Pool: 1 },
        state: "verified",
        source,
        revision: 1,
        verifiedBy: "owner:office",
        verifiedAt: "2026-10-01T12:00:00Z",
      },
    ],
    packages: [
      {
        id: ids.package,
        code: "pirates_rebellion",
        name: "Pirates",
        normalCapacity: 3,
        unavailableQuantity: 0,
      },
    ],
    resources: [
      {
        id: ids.resource,
        name: "Fixture pool",
        category: "Pool",
        status: "available",
        minimumTransferMinutes: 0,
      },
    ],
    obligations: [],
    holds: [],
    split: null,
    branches: [],
    travel: {
      endpointFingerprint: "fixture-endpoints",
      verified: true,
      source: "Reviewed route",
      verifiedAt: "2026-10-01T12:00:00Z",
      reasons: [],
    },
    authority: { accountId: ids.boss, revision: 1 },
    authorityEnabled: true,
    requests: [],
    decisions: [],
    now: "2026-10-02T00:00:00Z",
    sourceReasons: [],
    ...overrides,
  };
}
export const actors = {
  owner: { kind: "owner" as const, subject: "office" },
  dave: { kind: "boss" as const, accountId: ids.boss, sessionVersion: 1 },
  manager: { kind: "manager" as const, legId: ids.leg, sessionVersion: 1 },
} satisfies Record<string, PlanningActor>;
export function obligation(
  overrides: Partial<PlanObligation> = {},
): PlanObligation {
  return {
    canonicalId: ids.otherBooking,
    bookingId: ids.otherBooking,
    legId: "00000000-0000-4000-8000-000000000011",
    window: {
      startMs: 1816171200000,
      endMs: 1816603200000,
      source: "confirmed booking",
    },
    workerIds: [],
    resourceIds: [],
    packageQuantities: { [ids.package]: 1 },
    splitGroupId: null,
    ...overrides,
  };
}
export function decision(
  overrides: Partial<ApprovalDecision> = {},
): ApprovalDecision {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    requestId: "00000000-0000-4000-8000-000000000013",
    decision: "approved",
    reason: "Reviewed both crews and equipment",
    strategicAcknowledgement: false,
    actor: actors.dave,
    authorityRevision: 1,
    planFingerprint: "reviewed",
    decidedAt: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}
