import { describe, expect, it } from "vitest";

import {
  getAttractionTotalPolicy,
  getSpecialRequestAttractionDelta,
  packageAttributionForResource,
  validateSharedAttractionTotal,
} from "@/features/packages/package-policy";
import type { PackageTemplateSummary } from "@/features/packages/package-types";

const adventureZone: PackageTemplateSummary = {
  id: "adventure-zone",
  code: "adventure_zone",
  name: "Adventure Zone",
  baseAttractionCount: 10,
};

const weekendWarriors: PackageTemplateSummary = {
  id: "weekend-warriors",
  code: "weekend_warriors",
  name: "Weekend Warriors",
  baseAttractionCount: 5,
};

const piratesRebellion: PackageTemplateSummary = {
  id: "pirates-rebellion",
  code: "pirates_rebellion",
  name: "Pirates Rebellion",
  baseAttractionCount: 3,
};

describe("package attraction policy", () => {
  it.each([
    ["Adventure Zone", adventureZone, 10],
    ["Weekend Warriors", weekendWarriors, 5],
    ["Pirates Rebellion", piratesRebellion, 3],
  ] as const)("suggests the base total for %s", (_name, packageTemplate, suggested) => {
    expect(getAttractionTotalPolicy([packageTemplate])).toEqual({
      suggested,
      minimum: suggested,
      maximum: suggested,
    });
  });

  it.each([
    [adventureZone, weekendWarriors],
    [adventureZone, weekendWarriors, piratesRebellion],
  ] as const)("does not sum package bases when %i packages share physical attractions", (...packages) => {
    expect(getAttractionTotalPolicy(packages)).toEqual({
      suggested: 10,
      minimum: 10,
      maximum: 12,
    });
  });

  it.each([9, 13])("requires an approval reason for an out-of-range total of %i", (physicalAttractionTotal) => {
    expect(
      validateSharedAttractionTotal({
        packages: [adventureZone, weekendWarriors],
        physicalAttractionTotal,
        approvalReason: "   ",
      }),
    ).toEqual({ ok: false, error: { code: "APPROVAL_REASON_REQUIRED" } });
  });

  it("allows an out-of-range total with a nonblank approval reason", () => {
    expect(
      validateSharedAttractionTotal({
        packages: [adventureZone, weekendWarriors],
        physicalAttractionTotal: 13,
        approvalReason: "Customer requested additional activities",
      }),
    ).toEqual({ ok: true, value: undefined });
  });

  it("requires a physical total when packages are selected", () => {
    expect(
      validateSharedAttractionTotal({
        packages: [adventureZone],
        physicalAttractionTotal: null,
        approvalReason: null,
      }),
    ).toEqual({ ok: false, error: { code: "TOTAL_REQUIRED" } });
  });

  it("attributes one physical resource to each inferred selected package only once", () => {
    expect(
      packageAttributionForResource({
        selectedPackageIds: ["adventure-zone", "weekend-warriors", "adventure-zone"],
        resourcePackageIds: ["weekend-warriors", "adventure-zone", "unknown", "weekend-warriors"],
        manualPackageIds: null,
      }),
    ).toEqual([
      { packageTemplateId: "adventure-zone", source: "inferred" },
      { packageTemplateId: "weekend-warriors", source: "inferred" },
    ]);
  });

  it("uses manual attribution in place of inferred tags, including a deliberate empty override", () => {
    expect(
      packageAttributionForResource({
        selectedPackageIds: ["adventure-zone", "weekend-warriors", "pirates-rebellion"],
        resourcePackageIds: ["adventure-zone", "weekend-warriors"],
        manualPackageIds: ["weekend-warriors", "unknown", "weekend-warriors"],
      }),
    ).toEqual([{ packageTemplateId: "weekend-warriors", source: "manual" }]);

    expect(
      packageAttributionForResource({
        selectedPackageIds: ["adventure-zone"],
        resourcePackageIds: ["adventure-zone"],
        manualPackageIds: [],
      }),
    ).toEqual([]);
  });

  it.each([
    ["add_to_count", "needs_approval", 0],
    ["add_to_count", "declined", 0],
    ["add_to_count", "approved", 1],
    ["replace_included", "approved", 0],
    ["note_only", "approved", 0],
  ] as const)("counts %s requests with %s status by %i", (treatment, approvalStatus, delta) => {
    expect(getSpecialRequestAttractionDelta({ treatment, approvalStatus })).toBe(delta);
  });
});
