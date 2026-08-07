import { describe, expect, it } from "vitest";
import {
  ReportValidationError,
  reportActReplacementImport,
  type ActReplacementReportInput,
} from "./report-act-replacement-import";
import { REQUIRED_ROOTS } from "./verify-act-replacement-preview";

function fixture(): ActReplacementReportInput {
  const streams = REQUIRED_ROOTS.map((streamType) => ({
    streamType,
    state: "complete",
    completedCheckpoints: 1,
    totalCheckpoints: 1,
    error: null,
    responseRows: 1,
    observedIdentities: 1,
    archivedIdentities: 1,
    completeIdentities: 1,
    partialIdentities: 0,
    failedIdentities: 0,
    snapshotVersionsInserted: 1,
  }));
  return {
    status: {
      runId: "run-1",
      phase: "complete",
      previewOnly: true,
      applyEnabled: false,
      durableAdapters: { reviewReader: true, commandService: true, applyRepository: true },
      streams,
      allStreams: {
        responseRows: 7,
        observedIdentities: 7,
        archivedIdentities: 7,
        completeIdentities: 7,
        partialIdentities: 0,
        failedIdentities: 0,
        snapshotVersionsInserted: 7,
        unsupportedCapabilities: 0,
      },
      requiredStreams: [...REQUIRED_ROOTS],
      leaseSummary: { active: 0, expired: 0 },
      operations: [
        {
          operationKey: "organization:company-1",
          sourceVersionId: "version-1",
          targetType: "organization",
          status: "applied",
          requiredForSourceOutcome: true,
        },
      ],
      safeOperationCount: 0,
      reviewRequiredCount: 2,
      appliedOperationCount: 18,
      alreadyPresentOperationCount: 1,
      blockedOperationCount: 0,
      failedOperationCount: 0,
      manifestDigest: "digest-1",
      applyBatches: [{ state: "complete" }, { state: "complete" }],
    },
  };
}

describe("Act replacement import report", () => {
  it("emits exactly the allow-listed metadata columns and one aggregate row", () => {
    const result = reportActReplacementImport(fixture());
    const rows = result.csv.trim().split("\n");
    expect(rows).toEqual([
      "run_id,phase,manifest_digest,safe_operations,review_required,applied,already_present,blocked,failed,remaining,apply_batch_count,last_batch_state",
      "run-1,complete,digest-1,0,2,18,1,0,0,2,2,complete",
    ]);
    expect(result.csv).not.toMatch(
      /raw|source_database|display|request|password|secret|token|authorization|cookie|body/i,
    );
  });

  it("fails closed when required reconciliation evidence is missing", () => {
    const input = fixture();
    input.status.requiredStreams = undefined;
    input.status.leaseSummary = undefined;
    input.status.operations = undefined;
    expect(() => reportActReplacementImport(input)).toThrow(
      ReportValidationError,
    );
    expect(() => reportActReplacementImport(input)).toThrow(
      /required stream inventory|lease evidence|operation evidence/i,
    );
  });

  it("rejects unfinished batches and blocked or failed operations", () => {
    const input = fixture();
    input.status.applyBatches = [{ state: "applying" }];
    input.status.blockedOperationCount = 1;
    input.status.failedOperationCount = 1;
    expect(() => reportActReplacementImport(input)).toThrow(
      /batch|blocked|failed/i,
    );
  });
});
