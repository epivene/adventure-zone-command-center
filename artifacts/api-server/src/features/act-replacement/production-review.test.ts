import { describe, expect, it } from "vitest";

import {
  projectImportWorkflow,
  type ImportWorkflowProjectionInput,
} from "./production-review";

const CURRENT_DIGEST = "a".repeat(64);
const STALE_DIGEST = "b".repeat(64);

function input(): ImportWorkflowProjectionInput {
  return {
    phase: "ready_to_apply",
    summary: { manifestDigest: CURRENT_DIGEST },
    outcomes: [{ sourceRecordId: "source-one", state: "ready" }],
    operations: [
      {
        operationKey: "organization:one",
        sourceRecordId: "source-one",
        action: "create",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
      },
    ],
    batches: [],
  };
}

describe("durable production workflow projection", () => {
  it("counts already-present operations only from verified terminal batches", () => {
    const state = input();
    state.operations = [
      ...state.operations,
      {
        operationKey: "contact:existing",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
      },
      {
        operationKey: "contact:not-terminal",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
      },
    ];
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["contact:existing"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:1",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["contact:not-terminal"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      alreadyPresentOperationCount: 1,
      manifestDigest: CURRENT_DIGEST,
      nextApplyCursor: 1,
    });
  });

  it("fails closed when an active durable batch digest disagrees with the run manifest", () => {
    const state = input();
    state.operations = [
      ...state.operations,
      {
        operationKey: "contact:stale",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
      },
    ];
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:1",
        manifestDigest: STALE_DIGEST,
        operationIds: ["contact:stale"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      alreadyPresentOperationCount: 0,
      manifestDigest: null,
      nextApplyCursor: 0,
      canApplySafe: false,
    });
  });

  it("keeps a rebuilt manifest usable while retaining terminal prior-digest history", () => {
    const state = input();
    state.batches = [
      {
        requestKey: "old-approval:0",
        manifestDigest: STALE_DIGEST,
        operationIds: ["organization:old"],
        state: "complete_with_issues",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      manifestDigest: CURRENT_DIGEST,
      nextApplyCursor: 0,
      canApplySafe: true,
    });
  });

  it("advances only across terminal batches for the verified current digest", () => {
    const state = input();
    state.batches = [
      {
        requestKey: "safe-approval",
        approvalRequestKey: "safe-approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one", "contact:two", "booking:three"],
        state: "queued",
      },
      {
        requestKey: "apply-safe:0",
        approvalRequestKey: "safe-approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one", "contact:two"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:2",
        approvalRequestKey: "safe-approval",
        startCursor: 2,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["booking:three"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:3",
        approvalRequestKey: "safe-approval",
        startCursor: 3,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["activity:in-flight"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      manifestDigest: CURRENT_DIGEST,
      nextApplyCursor: 3,
      canApplySafe: true,
    });
  });

  it("does not advance the durable cursor for a failed, blocked, or applying batch", () => {
    const state = input();
    state.batches = [
      {
        requestKey: "approval:0",
        approvalRequestKey: "approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "complete_with_issues",
      },
      {
        requestKey: "approval:0:retry:1",
        approvalRequestKey: "approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      nextApplyCursor: 0,
      canApplySafe: true,
    });
  });

  it("does not infer a current digest from batch history when run state has none", () => {
    const state = input();
    state.summary = {};
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "complete",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      manifestDigest: null,
      nextApplyCursor: 0,
      canApplySafe: false,
    });
  });

  it("projects only safe fail-closed gate evidence from durable rows", () => {
    const state = input();
    state.phase = "complete";
    state.now = new Date("2026-08-07T12:00:00.000Z");
    state.leases = [
      { state: "leased", leaseExpiresAt: new Date("2026-08-07T11:59:00.000Z") },
    ];
    state.outcomes = [
      { sourceRecordId: "source-one", state: "awaiting_review" },
    ];
    state.operations = [
      {
        operationKey: "organization_contact:one:parent",
        sourceRecordId: "source-one",
        sourceVersionId: "version-one",
        targetType: "organization_contact",
        action: "create_relationship",
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
        status: "pending",
      },
    ];
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization_contact:one:parent"],
        state: "complete",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      requiredStreams: [
        "company",
        "contact",
        "opportunity",
        "group",
        "activity",
        "note",
        "history",
      ],
      leaseSummary: { active: 0, expired: 1 },
      operations: [
        {
          operationKey: "organization_contact:one:parent",
          sourceVersionId: "version-one",
          targetType: "organization_contact",
          status: "pending",
          requiredForSourceOutcome: true,
          heldForReview: true,
        },
      ],
      applyBatches: [{ state: "complete" }],
    });
  });

  it("projects required checkpoint inventory and deterministic batch order", () => {
    const state = input();
    state.requiredStreams = ["contact", "company", "company_contact", "contact"];
    state.batches = [
      { requestKey: "later", startCursor: 25, manifestDigest: CURRENT_DIGEST, operationIds: [], state: "complete", createdAt: new Date("2026-08-07T12:01:00Z"), id: "b" },
      { requestKey: "first", startCursor: 0, manifestDigest: CURRENT_DIGEST, operationIds: [], state: "complete_with_issues", createdAt: new Date("2026-08-07T12:00:00Z"), id: "a" },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      requiredStreams: ["company", "company_contact", "contact"],
      applyBatches: [{ state: "complete_with_issues" }, { state: "complete" }],
    });
  });

  it("makes a failed safe operation durably retryable after reload", () => {
    const state = input();
    state.phase = "complete_with_issues";
    state.operations[0]!.status = "failed";

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 1,
      failedOperationCount: 1,
      canApplySafe: true,
    });
  });
});
