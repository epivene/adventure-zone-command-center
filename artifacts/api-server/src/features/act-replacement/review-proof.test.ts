import { describe, expect, it } from "vitest";
import { localValueFingerprint } from "./local-edit-policy";
import { hasReviewedOverwriteProof } from "./review-proof";
import { projectBoundedApprovalPayload } from "./approval-projection";

const operation = () => ({
  action: "overwrite_reviewed",
  sourceVersionId: "version-a",
  targetType: "organization",
  payload: {
    entityId: "organization-a",
    fieldName: "phone",
    value: "555-ACT",
    proof: {
      entityType: "organization",
      entityId: "organization-a",
      fieldName: "phone",
      sourceVersionId: "version-a",
      expectedLocalValueFingerprint: localValueFingerprint("555-LOCAL"),
      decisionId: "decision-a",
      decision: "use_source",
      localValue: "555-LOCAL",
      sourceValue: "555-ACT",
    },
    decision: {
      id: "decision-a",
      sourceVersionId: "version-a",
      scope: "field_conflict",
      decision: "use_source",
      fieldName: "phone",
      targetEntityType: "organization",
      targetEntityId: "organization-a",
      reviewedSourceValue: "555-ACT",
      reviewedSourceValueFingerprint: localValueFingerprint("555-ACT"),
      reviewedLocalValue: "555-LOCAL",
      reviewedLocalValueFingerprint: localValueFingerprint("555-LOCAL"),
    },
  },
});

describe("reviewed operation proof", () => {
  it("binds optional durable reviewed values and fingerprints when present", () => {
    expect(hasReviewedOverwriteProof(operation())).toBe(true);
    const mismatched = operation();
    mismatched.payload.decision.reviewedLocalValueFingerprint = localValueFingerprint("other-local");
    expect(hasReviewedOverwriteProof(mismatched)).toBe(false);
  });

  it("fails closed when any required projected value was truncated", () => {
    const reviewed = operation();
    reviewed.payload.proof.sourceValue = "x".repeat(3 * 1024 * 1024);
    reviewed.payload.value = reviewed.payload.proof.sourceValue;
    const projected = {
      ...reviewed,
      payload: projectBoundedApprovalPayload(
        reviewed.action,
        reviewed.payload,
        "reviewed",
      ),
    };

    expect(hasReviewedOverwriteProof(projected)).toBe(false);
    expect(projected.payload).toMatchObject({
      _approvalProjection: { truncated: true },
    });
  });
});
