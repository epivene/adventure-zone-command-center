import { err, ok, type Result } from "@/lib/result";

import type {
  PackageTemplateSummary,
  RequestApprovalStatus,
  SpecialRequestTreatment,
} from "./package-types";

type AttractionTotalPolicy = {
  suggested: number | null;
  minimum: number | null;
  maximum: number | null;
};

type SharedAttractionTotalError = {
  code: "TOTAL_REQUIRED" | "APPROVAL_REASON_REQUIRED";
};

type PackageAttribution = {
  packageTemplateId: string;
  source: "inferred" | "manual";
};

export function getAttractionTotalPolicy(
  packages: readonly PackageTemplateSummary[],
): AttractionTotalPolicy {
  if (packages.length === 0) {
    return { suggested: null, minimum: null, maximum: null };
  }

  if (packages.length === 1) {
    const baseAttractionCount = packages[0]?.baseAttractionCount ?? null;
    return {
      suggested: baseAttractionCount,
      minimum: baseAttractionCount,
      maximum: baseAttractionCount,
    };
  }

  return { suggested: 10, minimum: 10, maximum: 12 };
}

export function validateSharedAttractionTotal(input: {
  packages: readonly PackageTemplateSummary[];
  physicalAttractionTotal: number | null;
  approvalReason: string | null;
}): Result<void, SharedAttractionTotalError> {
  if (input.packages.length === 0 || input.physicalAttractionTotal === null) {
    return input.packages.length === 0 ? ok(undefined) : err({ code: "TOTAL_REQUIRED" });
  }

  const policy = getAttractionTotalPolicy(input.packages);
  const isOutOfRange =
    input.physicalAttractionTotal < (policy.minimum ?? input.physicalAttractionTotal) ||
    input.physicalAttractionTotal > (policy.maximum ?? input.physicalAttractionTotal);

  if (isOutOfRange && !input.approvalReason?.trim()) {
    return err({ code: "APPROVAL_REASON_REQUIRED" });
  }

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
