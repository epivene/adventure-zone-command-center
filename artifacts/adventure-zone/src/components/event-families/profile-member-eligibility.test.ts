import { describe, expect, it } from "vitest";

import { eventFamilyCandidateStatus } from "./profile-member-eligibility";

describe("eventFamilyCandidateStatus", () => {
  it("blocks a consolidated retired profile and names its live replacement", () => {
    expect(eventFamilyCandidateStatus({
      eventFamilyId: null,
      parentContext: { kind: "organization_group", id: "live-1", name: "Colorado events" },
    }, "new-family")).toEqual({
      blocked: true,
      label: "Retired profile — use Colorado events instead",
      replacementProfileId: "live-1",
    });
  });

  it("still blocks profiles already assigned to an event family", () => {
    expect(eventFamilyCandidateStatus({ eventFamilyId: "family-2", parentContext: null }, "family-1"))
      .toMatchObject({ blocked: true, label: "Already in another event family" });
  });

  it("allows a normal active profile", () => {
    expect(eventFamilyCandidateStatus({ eventFamilyId: null, parentContext: null }, "family-1"))
      .toEqual({ blocked: false, label: null, replacementProfileId: null });
  });
});
