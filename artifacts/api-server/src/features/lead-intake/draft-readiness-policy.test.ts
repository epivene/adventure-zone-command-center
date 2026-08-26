import { describe, expect, it } from "vitest";

import {
  DEFAULT_AVAILABILITY_FUTURE_SKEW_MS,
  evaluateDraftReadiness,
} from "./draft-readiness-policy";

const now = new Date("2026-08-26T12:00:00.000Z");

function readyAt(checkedAt: string) {
  return evaluateDraftReadiness({
    rowId: "row-1",
    organizationId: "org-1",
    contactId: "contact-1",
    rowState: "verified",
    recipientEmail: "person@example.com",
    recipientConfirmed: true,
    introductionSuitable: true,
    relationshipOutcome: "new_introduction",
    territoryStatus: "open",
    fitStatus: "approved",
    communicationBlocks: [],
    availability: {
      ready: true,
      checkedAt,
      packageAvailability: {
        status: "resolved",
        packages: [{ packageKey: "adventure_zone", availableQuantity: 1 }],
        restrictedOptions: [],
      },
    },
    now,
  });
}

describe("availability checkedAt clock policy", () => {
  it("accepts the exact documented future-skew boundary", () => {
    const checkedAt = new Date(now.getTime() + DEFAULT_AVAILABILITY_FUTURE_SKEW_MS).toISOString();
    expect(readyAt(checkedAt)).toEqual({ ready: true, blockers: [] });
  });

  it("rejects a checkedAt one millisecond beyond the future-skew boundary", () => {
    const checkedAt = new Date(now.getTime() + DEFAULT_AVAILABILITY_FUTURE_SKEW_MS + 1).toISOString();
    expect(readyAt(checkedAt)).toEqual({ ready: false, blockers: ["availability_stale"] });
  });

  it("rejects a malformed checkedAt", () => {
    expect(readyAt("not-a-time")).toEqual({ ready: false, blockers: ["availability_stale"] });
  });
});
