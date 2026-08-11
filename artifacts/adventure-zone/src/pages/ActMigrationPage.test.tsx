import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActMigrationPage from "./ActMigrationPage";

const client = vi.hoisted(() => ({
  getLatestRun: vi.fn(),
  getRun: vi.fn(),
  startRun: vi.fn(),
  resumeRun: vi.fn(),
  supersedeRun: vi.fn(),
  organizeRun: vi.fn(),
  getReview: vi.fn(),
  getAssignmentTargets: vi.fn(),
  decideReviewRecord: vi.fn(),
  assignReviewParent: vi.fn(),
  bulkDecideReviewRecords: vi.fn(),
  approveSafeDefaults: vi.fn(),
  approveReadyOperations: vi.fn(),
  getManifest: vi.fn(),
  applyNext: vi.fn(),
}));

vi.mock(
  "@/features/act-replacement/act-replacement-client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/act-replacement/act-replacement-client")
    >()),
    ...client,
  }),
);

const digest = "a".repeat(64);
const individualReviewToken = {
  sourceRecordId: "source-1",
  sourceVersionId: "version-1",
  fieldName: "phone",
  sourceValueFingerprint: "b".repeat(64),
  targetEntityType: "organization",
  targetEntityId: "local-organization",
  localValueFingerprint: "c".repeat(64),
};
const counters = {
  responseRows: 0,
  observedIdentities: 0,
  archivedIdentities: 0,
  completeIdentities: 0,
  partialIdentities: 0,
  failedIdentities: 0,
  snapshotVersionsInserted: 0,
  unsupportedCapabilities: 0,
};

function readyRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    phase: "ready_to_apply",
    previewOnly: true,
    pageSize: 100,
    streams: [],
    allStreams: counters,
    canResume: false,
    canStartOver: true,
    safeOperationCount: 42,
    autoResolvedCount: 12,
    archivedOnlyCount: 3,
    reviewRequiredCount: 3,
    appliedOperationCount: 0,
    alreadyPresentOperationCount: 0,
    blockedOperationCount: 0,
    failedOperationCount: 0,
    manifestDigest: digest,
    nextApplyCursor: 0,
    canOrganize: false,
    canReview: true,
    canApplySafe: true,
    ...overrides,
  };
}

function reviewPage() {
  return { page: 1, pageSize: 25, total: 0, manifestDigest: digest, rows: [] };
}

function approvalWithOperationIds(count: number) {
  return {
    approvedOperationCount: count,
    manifestDigest: digest,
  };
}

function boundedSafeApproval(count: number) {
  return {
    approvedOperationCount: count,
    manifestDigest: digest,
  };
}

function manifestForApproval(count: number) {
  return {
    manifest: {
      digest,
      operations: Array.from({ length: count }, (_, index) => ({
        operationKey: `operation:${index}`,
        sourceRecordId: `source-${Math.floor(index / 2)}`,
        sourceVersionId: `version-${index}`,
        targetType: "contact",
        action: "create",
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      })),
    },
  };
}

function batchResult(
  nextCursor: number,
  hasMore: boolean,
  overrides: Record<string, number> = {},
) {
  const operationCount = nextCursor % 25 || 25;
  return {
    batch: {
      batchId: `batch-${nextCursor}`,
      runId: readyRun().runId,
      manifestDigest: digest,
      state: "complete",
      operationCount,
      completedCount: operationCount,
      alreadyPresentCount: 0,
      blockedCount: 0,
      failedCount: 0,
      ...overrides,
    },
    nextCursor,
    hasMore,
    requiresReview:
      Number(overrides.blockedCount ?? 0) > 0 ||
      Number(overrides.failedCount ?? 0) > 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getLatestRun.mockResolvedValue({ run: null });
  client.getRun.mockResolvedValue({ run: readyRun({ phase: "complete" }) });
  client.startRun.mockResolvedValue({
    created: true,
    run: readyRun({
      phase: "extracting",
      manifestDigest: null,
      safeOperationCount: 0,
      reviewRequiredCount: 0,
      canApplySafe: false,
    }),
  });
  client.getReview.mockResolvedValue(reviewPage());
  client.getAssignmentTargets.mockResolvedValue({ targets: [] });
  client.getManifest.mockResolvedValue(manifestForApproval(100));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ActMigrationPage", () => {
  it("clears a transient polling error after the next successful refresh", async () => {
    vi.useFakeTimers();
    try {
      const organizingRun = readyRun({
        phase: "organizing",
        manifestDigest: null,
        canApplySafe: false,
      });
      client.getLatestRun.mockResolvedValue({ run: organizingRun });
      client.getRun
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({ run: readyRun() });

      render(<ActMigrationPage />);
      await act(async () => Promise.resolve());

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
      expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap slow status polls", async () => {
    vi.useFakeTimers();
    try {
      const organizingRun = readyRun({
        phase: "organizing",
        manifestDigest: null,
        canApplySafe: false,
      });
      let finishPoll!: (value: { run: ReturnType<typeof readyRun> }) => void;
      const slowPoll = new Promise<{ run: ReturnType<typeof readyRun> }>(
        (resolve) => {
          finishPoll = resolve;
        },
      );
      client.getLatestRun.mockResolvedValue({ run: organizingRun });
      client.getRun.mockReturnValue(slowPoll);

      render(<ActMigrationPage />);
      await act(async () => Promise.resolve());
      await act(async () => {
        vi.advanceTimersByTime(6_000);
        await Promise.resolve();
      });

      expect(client.getRun).toHaveBeenCalledTimes(1);
      finishPoll({ run: readyRun() });
      await act(async () => Promise.resolve());
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers one import flow without legacy credentials or unsafe controls", async () => {
    render(<ActMigrationPage />);
    expect(
      await screen.findByRole("button", {
        name: /import everything from act/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/calendar.*route scan/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/password|username|database/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /overwrite|delete/i }),
    ).not.toBeInTheDocument();
  });

  it("limits advanced fetch sizes and defaults to 100", async () => {
    render(<ActMigrationPage />);
    expect(await screen.findByLabelText(/batch size/i)).toHaveValue("100");
    expect(screen.getByRole("option", { name: "25" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "50" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "200" })).toBeInTheDocument();
  });

  it("offers automatic review followed by safe import without manual review", async () => {
    client.getLatestRun.mockResolvedValue({ run: readyRun() });

    render(<ActMigrationPage />);

    expect(
      await screen.findByText("42 safe operations ready"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("12 records auto-resolved from strong context clues"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 uncertain records kept in the archive")).toBeInTheDocument();
    expect(
      screen.getByText(/automatic review.*separate safe import/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import safe records" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /overwrite|delete/i }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(client.getReview).toHaveBeenCalledWith(
        readyRun().runId,
        expect.objectContaining({ state: "needs_review" }),
      ),
    );
  });

  it("rebuilds an unapplied review manifest without refetching Act", async () => {
    const rebuildable = readyRun({ canOrganize: true });
    client.getLatestRun.mockResolvedValue({ run: rebuildable });
    client.organizeRun.mockResolvedValue({
      status: "ready_to_apply",
      manifest: { digest },
    });
    client.getRun.mockResolvedValue({
      run: readyRun({ safeOperationCount: 100, reviewRequiredCount: 2 }),
    });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Auto-review saved archive",
      }),
    );

    await waitFor(() =>
      expect(client.organizeRun).toHaveBeenCalledWith(rebuildable.runId),
    );
    expect(client.startRun).not.toHaveBeenCalled();
    expect(client.resumeRun).not.toHaveBeenCalled();
  });

  it("saves an import-as-new decision and reloads the rebuilt review queue", async () => {
    const run = readyRun({
      canOrganize: true,
      safeOperationCount: 0,
      reviewRequiredCount: 1,
    });
    const rebuiltRun = readyRun({
      canOrganize: true,
      safeOperationCount: 1,
      reviewRequiredCount: 0,
      manifestDigest: "b".repeat(64),
    });
    const ambiguousRow = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "awaiting_review",
      issueCodes: ["ambiguous_match"],
      issues: [{ code: "ambiguous_match" }],
      conflicts: [],
      candidates: [],
      operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.getRun.mockResolvedValue({ run: rebuiltRun });
    client.decideReviewRecord.mockResolvedValue({
      decision: { id: "decision-1" },
    });
    client.getReview
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 25,
        total: 1,
        manifestDigest: digest,
        rows: [ambiguousRow],
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 25,
        total: 0,
        manifestDigest: rebuiltRun.manifestDigest,
        rows: [],
      });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Import as new record — Adventure Zone",
      }),
    );

    await waitFor(() =>
      expect(client.decideReviewRecord).toHaveBeenCalledWith(
        run.runId,
        ambiguousRow.sourceRecordId,
        {
          sourceVersionId: ambiguousRow.sourceVersionId,
          scope: "duplicate_identity",
          decision: "keep_separate",
        },
      ),
    );
    await waitFor(() => expect(client.getReview).toHaveBeenCalledTimes(2));
    expect(client.getReview).toHaveBeenLastCalledWith(
      run.runId,
      expect.objectContaining({ page: 1, state: "needs_review" }),
    );
    expect(
      await screen.findByText("No review records match this view."),
    ).toBeInTheDocument();
  });

  it("saves a field decision and refreshes the current review page", async () => {
    const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
    const row = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "awaiting_review",
      issueCodes: ["field_conflict"],
      issues: [{ code: "field_conflict", reason: "phone" }],
      conflicts: [
        {
          fieldName: "phone",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
          target: { id: "local-organization", entityType: "organization", label: "Adventure Zone", detail: null },
          reviewToken: individualReviewToken,
        },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.decideReviewRecord.mockResolvedValue({ id: "decision-1" });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 1,
      manifestDigest: digest,
      summary: {
        decisionRequired: 1,
        archivedOnly: 1,
        issueCounts: { field_conflict: 1 },
        diagnosticCounts: {},
      },
      rows: [row],
    });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Keep current value — Phone for Adventure Zone",
      }),
    );

    await waitFor(() =>
      expect(client.decideReviewRecord).toHaveBeenCalledWith(
        run.runId,
        row.sourceRecordId,
        {
          sourceVersionId: row.sourceVersionId,
          scope: "field_conflict",
          decision: "keep_local",
          fieldName: "phone",
        },
      ),
    );
    await waitFor(() => expect(client.getRun).toHaveBeenCalledWith(run.runId));
  });

  it("sends the exact relationship slot selected by a skip action", async () => {
    const run = readyRun({ canOrganize: true, reviewRequiredCount: 1 });
    const row = {
      sourceRecordId: "activity-source",
      sourceVersionId: "activity-version",
      state: "awaiting_review" as const,
      issueCodes: ["relationship_unresolved"] as const,
      issues: [{ code: "relationship_unresolved" as const, reason: "Missing parents" }],
      conflicts: [], candidates: [], canImportStandalone: false, operationKeys: [],
      relationshipIssues: [
        { relationshipSlot: "primary-contact", issueCode: "relationship_unresolved" as const, reason: "Missing primary contact", expectedParentTypes: ["contact"] as const, canImportStandalone: false },
        { relationshipSlot: "billing-contact", issueCode: "relationship_unresolved" as const, reason: "Missing billing contact", expectedParentTypes: ["contact"] as const, canImportStandalone: false },
      ],
      streamType: "activity",
      display: { subject: "Call Ada" },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1, pageSize: 25, total: 1, manifestDigest: digest,
      summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: { relationship_unresolved: 2 }, diagnosticCounts: {} },
      rows: [row],
    });
    client.decideReviewRecord.mockResolvedValue({ id: "decision-1" });

    render(<ActMigrationPage />);
    const skips = await screen.findAllByRole("button", { name: /Keep archived and skip relationship/ });
    fireEvent.click(skips[1]!);

    await waitFor(() => expect(client.decideReviewRecord).toHaveBeenCalledWith(
      run.runId,
      row.sourceRecordId,
      {
        sourceVersionId: row.sourceVersionId,
        scope: "relationship",
        decision: "ignore_source",
        relationshipSlot: "billing-contact",
      },
    ));
  });

  it("keeps a reviewed overwrite out of automatic approval while applying the rebuilt safe subset", async () => {
    const rebuiltDigest = "d".repeat(64);
    const initialRun = readyRun({ canOrganize: true, reviewRequiredCount: 1, safeOperationCount: 1 });
    const rebuiltRun = readyRun({
      canOrganize: true,
      reviewRequiredCount: 0,
      safeOperationCount: 1,
      manifestDigest: rebuiltDigest,
    });
    const row = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "awaiting_review" as const,
      issueCodes: ["field_conflict"] as const,
      issues: [{ code: "field_conflict" as const, reason: "phone" }],
      conflicts: [{
        fieldName: "phone",
        localValue: "555-LOCAL",
        sourceValue: "555-ACT",
        target: { id: "local-organization", entityType: "organization", label: "Adventure Zone", detail: null },
        reviewToken: individualReviewToken,
      }],
      candidates: [],
      canImportStandalone: false,
      operationKeys: ["organization:source-1"],
      streamType: "company",
      display: { name: "Adventure Zone" },
    };
    const safeOperationId = "organization:source-1";
    const reviewedOverwriteId = "organization:source-1:field:phone";
    client.getLatestRun.mockResolvedValue({ run: initialRun });
    client.getRun.mockResolvedValue({ run: rebuiltRun });
    client.getReview
      .mockResolvedValueOnce({
        page: 1, pageSize: 25, total: 1, manifestDigest: digest,
        summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: { field_conflict: 1 }, diagnosticCounts: {} }, rows: [row],
      })
      .mockResolvedValue({
        page: 1, pageSize: 25, total: 0, manifestDigest: rebuiltDigest,
        summary: { decisionRequired: 0, archivedOnly: 0, issueCounts: {}, diagnosticCounts: {} }, rows: [],
      });
    client.decideReviewRecord.mockResolvedValue({ id: "decision-1" });
    client.approveSafeDefaults.mockResolvedValue({
      approvedOperationCount: 1,
      manifestDigest: rebuiltDigest,
    });
    client.getManifest.mockResolvedValue({
      manifest: {
        digest: rebuiltDigest,
        operations: [safeOperationId, reviewedOverwriteId].map((operationKey) => ({
          operationKey, sourceRecordId: "source-1", sourceVersionId: "version-1",
          targetType: "organization", action: operationKey.includes(":field:") ? "overwrite_reviewed" : "link_existing",
          dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: !operationKey.includes(":field:"),
        })),
      },
    });
    client.applyNext.mockResolvedValue({
      batch: { batchId: "batch-1", runId: initialRun.runId, manifestDigest: rebuiltDigest, state: "complete", operationCount: 1, completedCount: 1, alreadyPresentCount: 0, blockedCount: 0, failedCount: 0 },
      nextCursor: 1, hasMore: false, requiresReview: false,
    });

    render(<ActMigrationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Act value — Phone for Adventure Zone" }));
    await waitFor(() => expect(client.decideReviewRecord).toHaveBeenCalledWith(
      initialRun.runId,
      "source-1",
      expect.objectContaining({ decision: "use_source", fieldName: "phone", reviewToken: individualReviewToken }),
    ));
    await waitFor(() => expect(client.getReview).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Import safe records" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Yes, import safe records" }));

    await waitFor(() => expect(client.approveSafeDefaults).toHaveBeenCalledWith(
      initialRun.runId,
      rebuiltDigest,
      expect.any(String),
    ));
    expect(client.approveReadyOperations).not.toHaveBeenCalled();
    await waitFor(() => expect(client.applyNext).toHaveBeenCalledWith(
      initialRun.runId,
      expect.objectContaining({ expectedManifestDigest: rebuiltDigest }),
    ));
  });

  it("keeps review controls available after one safe subset completes and applies a rebuilt subset", async () => {
    const rebuiltDigest = "d".repeat(64);
    const initialRun = readyRun({
      canOrganize: true,
      canReview: true,
      reviewRequiredCount: 1,
      safeOperationCount: 1,
    });
    const completedRun = readyRun({
      phase: "complete",
      canOrganize: false,
      canReview: true,
      reviewRequiredCount: 1,
      safeOperationCount: 0,
      appliedOperationCount: 1,
      canApplySafe: false,
    });
    const rebuiltRun = readyRun({
      canOrganize: false,
      canReview: false,
      reviewRequiredCount: 0,
      safeOperationCount: 1,
      appliedOperationCount: 1,
      manifestDigest: rebuiltDigest,
    });
    const remainingRow = {
      sourceRecordId: "remaining-source",
      sourceVersionId: "remaining-version",
      state: "awaiting_review" as const,
      issueCodes: ["ambiguous_match"] as const,
      issues: [{ code: "ambiguous_match" as const }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: "Remaining company" },
    };
    client.getLatestRun.mockResolvedValue({ run: initialRun });
    client.getRun
      .mockResolvedValueOnce({ run: completedRun })
      .mockResolvedValue({ run: rebuiltRun });
    client.getReview
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 25,
        total: 1,
        manifestDigest: digest,
        summary: {
          decisionRequired: 1,
          archivedOnly: 1,
          issueCounts: { ambiguous_match: 1 },
          diagnosticCounts: {},
        },
        rows: [remainingRow],
      })
      .mockResolvedValue({
        page: 1,
        pageSize: 25,
        total: 0,
        manifestDigest: rebuiltDigest,
        summary: {
          decisionRequired: 0,
          archivedOnly: 0,
          issueCounts: {},
          diagnosticCounts: {},
        },
        rows: [],
      });
    client.approveSafeDefaults
      .mockResolvedValueOnce(approvalWithOperationIds(1))
      .mockResolvedValueOnce({
        approvedOperationCount: 1,
        manifestDigest: rebuiltDigest,
      });
    client.getManifest
      .mockResolvedValueOnce(manifestForApproval(1))
      .mockResolvedValueOnce({
        manifest: {
          digest: rebuiltDigest,
          operations: [
            {
              operationKey: "operation:rebuilt",
              sourceRecordId: "remaining-source",
              sourceVersionId: "remaining-version",
              targetType: "organization",
              action: "create",
              dependencyOperationKeys: [],
              requiredForSourceOutcome: true,
              safeByDefault: true,
            },
          ],
        },
      });
    client.applyNext
      .mockResolvedValueOnce(batchResult(1, false, { operationCount: 1 }))
      .mockResolvedValueOnce({
        ...batchResult(1, false, { operationCount: 1 }),
        batch: {
          ...batchResult(1, false, { operationCount: 1 }).batch,
          manifestDigest: rebuiltDigest,
        },
      });
    client.decideReviewRecord.mockResolvedValue({ id: "remaining-decision" });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    const remainingAction = await screen.findByRole("button", {
      name: "Import as new record — Remaining company",
    });
    expect(
      screen.queryByRole("button", { name: "Rebuild review from archive" }),
    ).not.toBeInTheDocument();
    fireEvent.click(remainingAction);
    await waitFor(() =>
      expect(client.decideReviewRecord).toHaveBeenCalledWith(
        initialRun.runId,
        "remaining-source",
        expect.objectContaining({
          sourceVersionId: "remaining-version",
          scope: "duplicate_identity",
          decision: "keep_separate",
        }),
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    await waitFor(() => expect(client.applyNext).toHaveBeenCalledTimes(2));
    expect(client.approveSafeDefaults).toHaveBeenLastCalledWith(
      initialRun.runId,
      rebuiltDigest,
      expect.any(String),
    );
    expect(client.applyNext).toHaveBeenLastCalledWith(
      initialRun.runId,
      expect.objectContaining({ expectedManifestDigest: rebuiltDigest }),
    );
  });

  it("confirms the exact selected overwrite count and sends no bulk request when cancelled", async () => {
    const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
    const row = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "awaiting_review",
      issueCodes: ["field_conflict"],
      issues: [{ code: "field_conflict", reason: "phone" }],
      conflicts: [
        {
          fieldName: "phone",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
          target: { id: "local-organization", entityType: "organization", label: "Adventure Zone", detail: null },
          reviewToken: individualReviewToken,
        },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 1,
      manifestDigest: digest,
      summary: {
        decisionRequired: 1,
        archivedOnly: 1,
        issueCounts: { field_conflict: 1 },
        diagnosticCounts: {},
      },
      rows: [row],
    });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Select Phone conflict for bulk review — Adventure Zone",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Use Act value for 1 selected conflict",
      }),
    );

    expect(
      screen.getByText(
        "Use Act values for 1 selected conflicts? This will overwrite 1 populated app fields.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(client.bulkDecideReviewRecords).not.toHaveBeenCalled();
  });

  it("submits the immutable overwrite snapshot after the review rerenders", async () => {
    const run = readyRun({ reviewRequiredCount: 2, canOrganize: true });
    const rows = ["source-1", "source-2"].map((sourceRecordId) => ({
      sourceRecordId,
      sourceVersionId: `${sourceRecordId}-version`,
      state: "awaiting_review" as const,
      issueCodes: ["field_conflict"] as const,
      issues: [{ code: "field_conflict" as const, reason: "phone" }],
      conflicts: [
        {
          fieldName: "phone",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
          target: { id: `local-${sourceRecordId}`, entityType: "organization", label: sourceRecordId, detail: null },
          reviewToken: {
            sourceRecordId,
            sourceVersionId: `${sourceRecordId}-version`,
            fieldName: "phone",
            sourceValueFingerprint: "b".repeat(64),
            targetEntityType: "organization",
            targetEntityId: `local-${sourceRecordId}`,
            localValueFingerprint: "c".repeat(64),
          },
        },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: sourceRecordId },
    }));
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 2,
      manifestDigest: digest,
      summary: {
        decisionRequired: 2,
        archivedOnly: 2,
        issueCounts: { field_conflict: 2 },
        diagnosticCounts: {},
      },
      rows,
    });
    client.bulkDecideReviewRecords.mockResolvedValue({});
    client.getRun.mockResolvedValue({ run });

    render(<ActMigrationPage />);
    const checkboxes = await screen.findAllByRole("checkbox", {
      name: /Select Phone conflict for bulk review —/,
    });
    fireEvent.click(checkboxes[0]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Use Act value for 1 selected conflict",
      }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Use Act values for 1 selected conflicts",
    );
    expect(document.querySelector("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use Act values" }));

    await waitFor(() =>
      expect(client.bulkDecideReviewRecords).toHaveBeenCalledWith(
        run.runId,
        expect.objectContaining({
          expectedManifestDigest: digest,
          fieldName: "phone",
          selections: [
            {
              sourceRecordId: "source-1",
              sourceVersionId: "source-1-version",
              reviewToken: expect.any(Object),
            },
          ],
        }),
      ),
    );
  });

  it("does not offer duplicate-identity bulk actions in the normal automatic flow", async () => {
    const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
    const row = {
      sourceRecordId: "recommended-company",
      sourceVersionId: "recommended-version",
      state: "awaiting_review" as const,
      issueCodes: ["ambiguous_match"] as const,
      issues: [{ code: "ambiguous_match" as const }],
      conflicts: [], candidates: [], canImportStandalone: false, operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
      recommendation: {
        action: "link_existing" as const,
        target: { id: "organization-1", entityType: "organization" as const, label: "Adventure Zone LLC", detail: "Chicago, IL" },
        confidence: "two_independent_clues" as const,
        evidence: [
          { family: "identity" as const, label: "Matching name" },
          { family: "archive_relationship" as const, label: "Matching saved relationship" },
        ],
      },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.getRun.mockResolvedValue({ run: { ...run, reviewRequiredCount: 0 } });
    client.getReview.mockResolvedValue({
      page: 1, pageSize: 25, total: 1, manifestDigest: digest,
      summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: { ambiguous_match: 1 }, diagnosticCounts: {} },
      rows: [row],
    });
    render(<ActMigrationPage />);

    await screen.findByText("Matched from name + company relationship");
    expect(
      screen.queryByRole("button", { name: "Select all safe matches on this page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept selected safe matches" }),
    ).not.toBeInTheDocument();
    expect(client.bulkDecideReviewRecords).not.toHaveBeenCalled();
  });

  it("filters and isolates row-specific assignment target searches", async () => {
    const run = readyRun({ reviewRequiredCount: 2, canOrganize: true });
    const contactRow = {
      sourceRecordId: "contact-source",
      sourceVersionId: "contact-version",
      state: "awaiting_review" as const,
      issueCodes: ["ambiguous_match"] as const,
      issues: [{ code: "ambiguous_match" as const }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "contact",
      display: { name: "Ada" },
    };
    const relationshipRow = {
      sourceRecordId: "activity-source",
      sourceVersionId: "activity-version",
      state: "awaiting_review" as const,
      issueCodes: ["relationship_unresolved"] as const,
      issues: [
        { code: "relationship_unresolved" as const, reason: "Missing parent" },
      ],
      conflicts: [],
      candidates: [],
      canImportStandalone: true,
      relationshipIssues: [{
        relationshipSlot: "timeline-parent",
        issueCode: "relationship_unresolved" as const,
        reason: "Missing parent",
        expectedParentTypes: ["organization", "contact", "booking"] as const,
        canImportStandalone: true,
      }],
      operationKeys: [],
      streamType: "activity",
      display: { subject: "Call Ada" },
    };
    let resolveContact!: (value: { targets: unknown[] }) => void;
    const slowContact = new Promise<{ targets: unknown[] }>((resolve) => {
      resolveContact = resolve;
    });
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 2,
      manifestDigest: digest,
      summary: { decisionRequired: 2, archivedOnly: 2, issueCounts: {}, diagnosticCounts: {} },
      rows: [contactRow, relationshipRow],
    });
    client.getAssignmentTargets
      .mockReturnValueOnce(slowContact)
      .mockResolvedValueOnce({
        targets: [
          {
            id: "organization-1",
            entityType: "organization",
            label: "Adventure Zone",
            detail: null,
          },
          {
            id: "contact-1",
            entityType: "contact",
            label: "Ada Lovelace",
            detail: null,
          },
          {
            id: "activity-1",
            entityType: "activity",
            label: "Wrong child type",
            detail: null,
          },
        ],
      });

    render(<ActMigrationPage />);
    const contactSearch = await screen.findByRole("searchbox", {
      name: "Search existing records — Link target for Ada",
    });
    const activitySearch = screen.getByRole("searchbox", {
      name: "Search existing records — Parent target for Call Ada",
    });
    expect(client.getAssignmentTargets).not.toHaveBeenCalled();
    fireEvent.change(contactSearch, { target: { value: "Ada" } });
    fireEvent.change(activitySearch, { target: { value: "Call" } });

    await waitFor(() =>
      expect(client.getAssignmentTargets).toHaveBeenLastCalledWith({
        search: "Call",
        entityTypes: ["organization", "contact", "booking"],
      }),
    );
    expect(
      screen.getByRole("option", { name: "Adventure Zone" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Wrong child type" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", {
      name: "Select an existing record — Parent target for Call Ada",
    }), { target: { value: "organization-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign parent — Call Ada" }));
    await waitFor(() => expect(client.assignReviewParent).toHaveBeenCalledWith(
      run.runId,
      relationshipRow,
      expect.objectContaining({ id: "organization-1", entityType: "organization" }),
      relationshipRow.relationshipIssues[0],
    ));
    resolveContact({
      targets: [
        {
          id: "wrong-type",
          entityType: "organization",
          label: "Wrong target",
          detail: null,
        },
      ],
    });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("option", { name: "Wrong target" })).toBeNull();
  });

  it("ignores an older assignment-search rejection after a newer success", async () => {
    const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
    const row = {
      sourceRecordId: "contact-source",
      sourceVersionId: "contact-version",
      state: "awaiting_review" as const,
      issueCodes: ["ambiguous_match"] as const,
      issues: [{ code: "ambiguous_match" as const }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "contact",
      display: { name: "Ada" },
    };
    let rejectOlder!: (reason: Error) => void;
    const older = new Promise<{ targets: unknown[] }>((_, reject) => {
      rejectOlder = reject;
    });
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 1,
      manifestDigest: digest,
      summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: {}, diagnosticCounts: {} },
      rows: [row],
    });
    client.getAssignmentTargets
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce({
        targets: [
          {
            id: "ada",
            entityType: "contact",
            label: "Ada Lovelace",
            detail: null,
          },
        ],
      });

    render(<ActMigrationPage />);
    const search = await screen.findByRole("searchbox", {
      name: "Search existing records — Link target for Ada",
    });
    fireEvent.change(search, { target: { value: "A" } });
    fireEvent.change(search, { target: { value: "Ada" } });
    expect(
      await screen.findByRole("option", { name: "Ada Lovelace" }),
    ).toBeInTheDocument();

    rejectOlder(new Error("older search failed"));
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("option", { name: "Ada Lovelace" }),
    ).toBeInTheDocument();
  });

  it("clears an assignment-target error when the picker closes", async () => {
    const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
    const row = {
      sourceRecordId: "contact-source",
      sourceVersionId: "contact-version",
      state: "awaiting_review" as const,
      issueCodes: ["ambiguous_match"] as const,
      issues: [{ code: "ambiguous_match" as const }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "contact",
      display: { name: "Ada" },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 1,
      manifestDigest: digest,
      summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: {}, diagnosticCounts: {} },
      rows: [row],
    });
    client.getAssignmentTargets.mockRejectedValue(new Error("search failed"));

    render(<ActMigrationPage />);
    const search = await screen.findByRole("searchbox", {
      name: "Search existing records — Link target for Ada",
    });
    fireEvent.change(search, { target: { value: "Ada" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "search failed",
    );

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["success", "rejection"] as const)(
    "ignores a pre-invalidation assignment-search %s after a new search begins",
    async (outcome) => {
      const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
      const row = {
        sourceRecordId: "contact-source",
        sourceVersionId: "contact-version",
        state: "awaiting_review" as const,
        issueCodes: ["ambiguous_match", "field_conflict"] as const,
        issues: [
          { code: "ambiguous_match" as const },
          { code: "field_conflict" as const, reason: "phone" },
        ],
        conflicts: [
          { fieldName: "phone", localValue: "local", sourceValue: "Act" },
        ],
        candidates: [],
        canImportStandalone: false,
        operationKeys: [],
        streamType: "contact",
        display: { name: "Ada" },
      };
      let settleOlder!: (value?: { targets: unknown[] }) => void;
      const older = new Promise<{ targets: unknown[] }>((resolve, reject) => {
        settleOlder = (value) =>
          outcome === "success"
            ? resolve(
                value ?? {
                  targets: [
                    {
                      id: "old",
                      entityType: "contact",
                      label: "Old Ada",
                      detail: null,
                    },
                  ],
                },
              )
            : reject(new Error("old search failed"));
      });
      client.getLatestRun.mockResolvedValue({ run });
      client.getRun.mockResolvedValue({ run });
      client.decideReviewRecord.mockResolvedValue({ id: "decision" });
      client.getReview.mockResolvedValue({
        page: 1,
        pageSize: 25,
        total: 1,
        manifestDigest: digest,
        summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: {}, diagnosticCounts: {} },
        rows: [row],
      });
      client.getAssignmentTargets
        .mockReturnValueOnce(older)
        .mockResolvedValueOnce({
          targets: [
            {
              id: "current",
              entityType: "contact",
              label: "Current Ada",
              detail: null,
            },
          ],
        });

      render(<ActMigrationPage />);
      fireEvent.change(
        await screen.findByPlaceholderText("Search existing records"),
        { target: { value: "A" } },
      );
      fireEvent.click(screen.getByText("Keep current value"));
      await waitFor(() => expect(client.getReview).toHaveBeenCalledTimes(2));
      const currentSearch = screen.getByPlaceholderText(
        "Search existing records",
      );
      await waitFor(() => expect(currentSearch).not.toBeDisabled());
      fireEvent.change(currentSearch, { target: { value: "B" } });
      expect(
        await screen.findByRole("option", { name: "Current Ada" }),
      ).toBeInTheDocument();

      settleOlder();
      await act(async () => Promise.resolve());
      expect(screen.getByRole("option", { name: "Current Ada" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Old Ada" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("invalidates an outstanding assignment search when the review digest changes", async () => {
    const run = readyRun({ reviewRequiredCount: 1, canOrganize: true });
    const refreshedRun = readyRun({
      reviewRequiredCount: 0,
      manifestDigest: "b".repeat(64),
      canOrganize: true,
    });
    const row = {
      sourceRecordId: "contact-source",
      sourceVersionId: "contact-version",
      state: "awaiting_review" as const,
      issueCodes: ["ambiguous_match", "field_conflict"] as const,
      issues: [
        { code: "ambiguous_match" as const },
        { code: "field_conflict" as const, reason: "phone" },
      ],
      conflicts: [
        { fieldName: "phone", localValue: "local", sourceValue: "Act" },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "contact",
      display: { name: "Ada" },
    };
    let resolveSearch!: (value: { targets: unknown[] }) => void;
    const pendingSearch = new Promise<{ targets: unknown[] }>((resolve) => {
      resolveSearch = resolve;
    });
    client.getLatestRun.mockResolvedValue({ run });
    client.getRun.mockResolvedValue({ run: refreshedRun });
    client.decideReviewRecord.mockResolvedValue({ id: "decision" });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 1,
      manifestDigest: digest,
      summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: {}, diagnosticCounts: {} },
      rows: [row],
    });
    client.getAssignmentTargets.mockReturnValue(pendingSearch);

    render(<ActMigrationPage />);
    fireEvent.change(
      await screen.findByRole("searchbox", {
        name: "Search existing records — Link target for Ada",
      }),
      { target: { value: "Ada" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Keep current value — Phone for Ada",
      }),
    );
    await waitFor(() => expect(client.getReview).toHaveBeenCalledTimes(2));

    resolveSearch({
      targets: [
        {
          id: "ada",
          entityType: "contact",
          label: "Ada Lovelace",
          detail: null,
        },
      ],
    });
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("option", { name: "Ada Lovelace" })).toBeNull();
  });

  it("cancels import confirmation from Escape and returns focus without applying", async () => {
    const run = readyRun({ canOrganize: true });
    client.getLatestRun.mockResolvedValue({ run });
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(42));

    render(<ActMigrationPage />);
    const trigger = await screen.findByRole("button", {
      name: "Import safe records",
    });
    trigger.focus();
    fireEvent.click(trigger);

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Import safe records?",
    );
    const confirm = screen.getByRole("button", {
      name: "Yes, import safe records",
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(client.applyNext).not.toHaveBeenCalled();
  });

  it("clamps and refetches the current page after resolving its last item", async () => {
    const run = readyRun({ reviewRequiredCount: 26, canOrganize: true });
    const row = {
      sourceRecordId: "source-26",
      sourceVersionId: "version-26",
      state: "awaiting_review" as const,
      issueCodes: ["field_conflict"] as const,
      issues: [{ code: "field_conflict" as const, reason: "phone" }],
      conflicts: [
        { fieldName: "phone", localValue: "local", sourceValue: "Act" },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: "Last record" },
    };
    client.getLatestRun.mockResolvedValue({ run });
    client.getRun.mockResolvedValue({ run });
    client.decideReviewRecord.mockResolvedValue({ id: "decision" });
    client.getReview
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 25,
        total: 26,
        manifestDigest: digest,
        summary: { decisionRequired: 26, archivedOnly: 26, issueCounts: {}, diagnosticCounts: {} },
        rows: [],
      })
      .mockResolvedValueOnce({
        page: 2,
        pageSize: 25,
        total: 26,
        manifestDigest: digest,
        summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: {}, diagnosticCounts: {} },
        rows: [row],
      })
      .mockResolvedValueOnce({
        page: 2,
        pageSize: 25,
        total: 25,
        manifestDigest: digest,
        summary: { decisionRequired: 0, archivedOnly: 0, issueCounts: {}, diagnosticCounts: {} },
        rows: [],
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 25,
        total: 25,
        manifestDigest: digest,
        summary: { decisionRequired: 0, archivedOnly: 0, issueCounts: {}, diagnosticCounts: {} },
        rows: [],
      });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Next review page" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Keep current value — Phone for Last record",
      }),
    );

    await waitFor(() => expect(client.getReview).toHaveBeenCalledTimes(4));
    expect(client.getReview).toHaveBeenLastCalledWith(
      run.runId,
      expect.objectContaining({ page: 1, state: "needs_review" }),
    );
  });

  it("does not offer ambiguity decisions after import activity locks rebuilding", async () => {
    const run = readyRun({
      canOrganize: false,
      canReview: false,
      reviewRequiredCount: 1,
    });
    client.getLatestRun.mockResolvedValue({ run });
    client.getReview.mockResolvedValue({
      page: 1,
      pageSize: 25,
      total: 1,
      manifestDigest: digest,
      rows: [
        {
          sourceRecordId: "source-1",
          sourceVersionId: "version-1",
          state: "awaiting_review",
          issueCodes: ["ambiguous_match"],
          operationKeys: [],
          streamType: "company",
          display: { name: "Adventure Zone" },
        },
      ],
    });

    render(<ActMigrationPage />);

    expect(await screen.findByText("Adventure Zone")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Import as new record — Adventure Zone",
      }),
    ).not.toBeInTheDocument();
    expect(client.decideReviewRecord).not.toHaveBeenCalled();
  });

  it("organizes an extracted run and refreshes its durable status", async () => {
    const extracted = readyRun({
      phase: "extract_complete",
      manifestDigest: null,
      safeOperationCount: 0,
      reviewRequiredCount: 0,
      canOrganize: true,
      canApplySafe: false,
    });
    client.getLatestRun.mockResolvedValue({ run: extracted });
    client.organizeRun.mockResolvedValue({
      status: "ready_to_apply",
      manifest: { digest },
    });
    client.getRun.mockResolvedValue({ run: readyRun() });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Auto-review fetched archive" }),
    );

    await waitFor(() =>
      expect(client.organizeRun).toHaveBeenCalledWith(extracted.runId),
    );
    expect(client.getRun).toHaveBeenCalledWith(extracted.runId);
    expect(
      await screen.findByText("42 safe operations ready"),
    ).toBeInTheDocument();
  });

  it("moves from accepted auto-review polling to an operation-only safe import without review decisions", async () => {
    // Protects against reintroducing a manual-decision step or presenting the
    // safe-import confirmation as a record-level operation.
    const extracted = readyRun({
      phase: "extract_complete",
      manifestDigest: null,
      safeOperationCount: 0,
      autoResolvedCount: 0,
      archivedOnlyCount: 0,
      reviewRequiredCount: 0,
      canOrganize: true,
      canApplySafe: false,
    });
    const organizing = readyRun({
      phase: "organizing",
      manifestDigest: null,
      safeOperationCount: 0,
      autoResolvedCount: 0,
      archivedOnlyCount: 0,
      reviewRequiredCount: 0,
      canOrganize: false,
      canApplySafe: false,
    });
    const automaticallyReviewed = readyRun({
      safeOperationCount: 5,
      autoResolvedCount: 2,
      archivedOnlyCount: 3,
      reviewRequiredCount: 0,
      canReview: false,
    });
    client.getLatestRun.mockResolvedValue({ run: extracted });
    client.organizeRun.mockResolvedValue({ status: "organizing" });
    client.getRun
      .mockResolvedValueOnce({ run: organizing })
      .mockResolvedValueOnce({ run: automaticallyReviewed });
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(5));
    client.getManifest.mockResolvedValue(manifestForApproval(5));

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Auto-review fetched archive",
      }),
    );

    await waitFor(() => expect(client.organizeRun).toHaveBeenCalledWith(extracted.runId));
    expect(client.getRun).toHaveBeenCalledWith(extracted.runId);
    expect(
      await screen.findByText("5 safe operations ready", {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 records auto-resolved from strong context clues")).toBeInTheDocument();
    expect(screen.getByText("3 uncertain records kept in the archive")).toBeInTheDocument();
    expect(client.decideReviewRecord).not.toHaveBeenCalled();
    expect(client.bulkDecideReviewRecords).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import safe records" }));
    const confirmation = await screen.findByRole("dialog");
    expect(client.approveSafeDefaults).toHaveBeenCalledOnce();
    expect(client.approveReadyOperations).not.toHaveBeenCalled();
    expect(confirmation).toHaveTextContent(
      "5 safe operations will be processed in batches of 25.",
    );
    expect(confirmation).not.toHaveTextContent(/distinct source records/i);
  });

  it("prepares automatic import from the bounded server approval without loading the manifest", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({ safeOperationCount: 52, reviewRequiredCount: 0 }),
    });
    client.approveSafeDefaults.mockResolvedValue(boundedSafeApproval(52));

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "52 safe operations will be processed in batches of 25.",
    );
    expect(client.getManifest).not.toHaveBeenCalled();
    expect(client.approveSafeDefaults).toHaveBeenCalledOnce();
  });

  it("continues 25-operation batches until complete with one base request key", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({ safeOperationCount: 52, reviewRequiredCount: 0 }),
    });
    client.approveSafeDefaults.mockResolvedValue(
      approvalWithOperationIds(52),
    );
    client.getManifest.mockResolvedValue(manifestForApproval(52));
    client.applyNext
      .mockResolvedValueOnce(batchResult(25, true))
      .mockResolvedValueOnce(batchResult(50, true))
      .mockResolvedValueOnce(
        batchResult(52, false, { operationCount: 2, completedCount: 2 }),
      );

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Only reviewer-approved overwrites may replace populated fields",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Imported records are not automatically removed",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "52 safe operations will be processed in batches of 25.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    await waitFor(() =>
      expect(client.approveSafeDefaults).toHaveBeenCalledWith(
        readyRun().runId,
        digest,
        `act-safe-${readyRun().runId}-${digest}-apply-52-0-0-0`,
      ),
    );
    await waitFor(() => expect(client.applyNext).toHaveBeenCalledTimes(3));
    const calls = client.applyNext.mock.calls;
    expect(calls.every(([, body]) => body.batchSize === 25)).toBe(true);
    expect(new Set(calls.map(([, body]) => body.approvalRequestKey)).size).toBe(
      1,
    );
    expect(
      calls.every(
        ([, body]) => !("approvedOperationIds" in body) && !("cursor" in body),
      ),
    ).toBe(true);
  });

  it("resumes a partially applied import from durable workflow status after reload", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({
        phase: "applying",
        safeOperationCount: 27,
        appliedOperationCount: 25,
        nextApplyCursor: 25,
      }),
    });
    client.approveSafeDefaults.mockResolvedValue(
      approvalWithOperationIds(27),
    );
    client.getManifest.mockResolvedValue(manifestForApproval(27));
    client.applyNext.mockResolvedValue(batchResult(50, false));

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume safe import" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "27 safe operations will be processed in batches of 25.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    await waitFor(() => expect(client.applyNext).toHaveBeenCalledOnce());
    expect(client.applyNext.mock.calls[0][1]).toMatchObject({
      batchSize: 25,
      approvalRequestKey: `act-safe-${readyRun().runId}-${digest}-apply-27-25-0-0`,
    });
    expect(client.applyNext.mock.calls[0][1]).not.toHaveProperty("cursor");
    expect(client.applyNext.mock.calls[0][1]).not.toHaveProperty(
      "approvedOperationIds",
    );
  });

  it("resets the progress cursor when a resumed run creates a fresh approval coordinator", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({
        phase: "applying",
        safeOperationCount: 52,
        appliedOperationCount: 25,
        nextApplyCursor: 25,
      }),
    });
    client.approveSafeDefaults.mockResolvedValue(
      approvalWithOperationIds(52),
    );
    client.getManifest.mockResolvedValue(manifestForApproval(52));
    client.applyNext
      .mockResolvedValueOnce(batchResult(25, true))
      .mockResolvedValueOnce(batchResult(50, true))
      .mockResolvedValueOnce(
        batchResult(52, false, { operationCount: 2, completedCount: 2 }),
      );

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume safe import" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    await waitFor(() => expect(client.applyNext).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("apply_cursor_stalled")).not.toBeInTheDocument();
  });

  it("restores the durable already-present total in the finish summary after reload", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({
        phase: "complete",
        safeOperationCount: 0,
        appliedOperationCount: 18,
        alreadyPresentOperationCount: 7,
        canApplySafe: false,
      }),
    });

    render(<ActMigrationPage />);

    const summary = await screen.findByRole("region", {
      name: "Import summary",
    });
    expect(within(summary).getByText("7")).toBeInTheDocument();
    expect(within(summary).getByText("Already present")).toBeInTheDocument();
  });

  it("stops after a blocked batch, refreshes durable status, and offers review", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({ safeOperationCount: 30 }),
    });
    client.approveSafeDefaults.mockResolvedValue(
      approvalWithOperationIds(30),
    );
    client.applyNext.mockResolvedValue(
      batchResult(25, true, { completedCount: 24, blockedCount: 1 }),
    );
    client.getRun.mockResolvedValue({
      run: readyRun({
        phase: "complete_with_issues",
        safeOperationCount: 5,
        blockedOperationCount: 1,
      }),
    });

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Review issues before retrying",
      }),
    ).toBeInTheDocument();
    expect(client.applyNext).toHaveBeenCalledOnce();
    expect(client.getRun).toHaveBeenCalledWith(readyRun().runId);
  });

  it("restores durable apply failures after reload and offers an explicit retry", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({
        phase: "complete_with_issues",
        safeOperationCount: 5,
        failedOperationCount: 1,
        canApplySafe: true,
      }),
    });
    client.approveSafeDefaults.mockResolvedValue(
      approvalWithOperationIds(5),
    );
    client.applyNext.mockResolvedValue(batchResult(30, false));

    render(<ActMigrationPage />);

    expect(
      await screen.findByRole("button", {
        name: "Review issues before retrying",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry failed import" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, retry failed import" }),
    );

    await waitFor(() => expect(client.applyNext).toHaveBeenCalledOnce());
    expect(client.applyNext.mock.calls[0][1]).toMatchObject({
      approvalRequestKey: `act-safe-${readyRun().runId}-${digest}-retry-5-0-0-1`,
      retryFailed: true,
    });
  });

  it("shows the server safety lock and does not retry act_apply_disabled", async () => {
    client.getLatestRun.mockResolvedValue({ run: readyRun() });
    client.approveSafeDefaults.mockResolvedValue(
      approvalWithOperationIds(42),
    );
    client.applyNext.mockRejectedValue(
      Object.assign(new Error("act_apply_disabled"), {
        code: "act_apply_disabled",
      }),
    );

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Live import is still safely locked on the server",
    );
    expect(client.applyNext).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: /retry safe import/i }),
    ).not.toBeInTheDocument();
  });
});
