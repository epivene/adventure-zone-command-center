import { describe, expect, it } from "vitest";

import { hasManualOrganizationMembershipConflict } from "./organization-repository";

describe("manual organization membership duplicate protection", () => {
  it("recognizes a parent/child pair so duplicate suggestions can exclude it", () => {
    const parent = { id: "parent", parentOrganizationId: null };
    const child = { id: "child", parentOrganizationId: "parent" };
    expect(hasManualOrganizationMembershipConflict([parent, child], ["parent", "child"])).toBe(true);
  });

  it("does not suppress unrelated records", () => {
    const left = { id: "left", parentOrganizationId: null };
    const right = { id: "right", parentOrganizationId: null };
    expect(hasManualOrganizationMembershipConflict([left, right], ["left", "right"])).toBe(false);
  });
});
