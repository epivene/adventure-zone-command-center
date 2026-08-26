import { err, ok, type Result } from "@/lib/result";

import type {
  PackageTemplateSummary,
  RequestApprovalStatus,
  SpecialRequestTreatment,
} from "./package-types";

export type AttractionTotalPolicy = {
  suggested: number | null;
  minimum: number | null;
  maximum: number | null;
  advisoryMessage: string | null;
};

type SharedAttractionTotalError = {
  code: "TOTAL_REQUIRED";
};

type PackageAttribution = {
  packageTemplateId: string;
  source: "inferred" | "manual";
};

export function getAttractionTotalPolicy(
  packages: readonly PackageTemplateSummary[],
): AttractionTotalPolicy {
  if (packages.length === 0) {
    return {
      suggested: null,
      minimum: null,
      maximum: null,
      advisoryMessage: null,
    };
  }

  const suggested = packages.reduce(
    (sum, pkg) => sum + pkg.baseAttractionCount,
    0,
  );
  const minimum = packages.reduce(
    (sum, pkg) => sum + (pkg.minimumAttractionCount ?? pkg.baseAttractionCount),
    0,
  );
  const maximum = packages.reduce(
    (sum, pkg) => sum + (pkg.maximumAttractionCount ?? pkg.baseAttractionCount),
    0,
  );

  return {
    suggested,
    minimum,
    maximum,
    advisoryMessage: null,
  };
}

export function validateSharedAttractionTotal(input: {
  packages: readonly PackageTemplateSummary[];
  physicalAttractionTotal: number | null;
  approvalReason: string | null;
}): Result<void, SharedAttractionTotalError> {
  if (input.packages.length === 0 || input.physicalAttractionTotal === null) {
    return input.packages.length === 0
      ? ok(undefined)
      : err({ code: "TOTAL_REQUIRED" });
  }

  // Package ranges are normal business guidance, not approval gates. Adventure
  // Zone routinely customizes package sizes, so an unusual count is surfaced
  // by the UI without blocking the save.
  return ok(undefined);
}

export function packageAttributionForResource(input: {
  selectedPackageIds: readonly string[];
  resourcePackageIds: readonly string[];
  manualPackageIds: readonly string[] | null;
}): PackageAttribution[] {
  const applicablePackageIds = new Set(
    input.manualPackageIds ?? input.resourcePackageIds,
  );
  const source = input.manualPackageIds === null ? "inferred" : "manual";

  return [...new Set(input.selectedPackageIds)]
    .filter((packageTemplateId) => applicablePackageIds.has(packageTemplateId))
    .map((packageTemplateId) => ({ packageTemplateId, source }));
}

export function getSpecialRequestAttractionDelta(input: {
  treatment: SpecialRequestTreatment;
  approvalStatus: RequestApprovalStatus;
}): number {
  return input.treatment === "add_to_count" && input.approvalStatus === "approved"
    ? 1
    : 0;
}

export type PackageInventoryPolicy = Record<string, {
  normalCapacity: number;
  restrictedOptions: Array<{
    key: string;
    approvalRequired: true;
    reason: string;
  }>;
}>;

export function getPackageInventoryPolicy(): PackageInventoryPolicy {
  return {
    adventure_zone: { normalCapacity: 5, restrictedOptions: [] },
    pirates_rebellion: {
      normalCapacity: 3,
      restrictedOptions: [{
        key: "pirates_rebellion_restricted_fourth_unit",
        approvalRequired: true,
        reason: "Massive pool; requires extremely flat ground.",
      }],
    },
    warriors_playground: { normalCapacity: 1, restrictedOptions: [] },
    mini_zone: {
      normalCapacity: 0,
      restrictedOptions: [{
        key: "mini_zone",
        approvalRequired: true,
        reason:
          "Last-resort / Dave approval only; estimated $5,000–$6,000 with final price set by Dave.",
      }],
    },
  };
}
