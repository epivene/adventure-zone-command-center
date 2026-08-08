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
  decideReviewRecord: vi.fn(),
  approveSafeDefaults: vi.fn(),
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
    reviewRequiredCount: 3,
    appliedOperationCount: 0,
    alreadyPresentOperationCount: 0,
    blockedOperationCount: 0,
    failedOperationCount: 0,
    manifestDigest: digest,
    nextApplyCursor: 0,
    canOrganize: false,
    canApplySafe: true,
    ...overrides,
  };
}

function reviewPage() {
  return { page: 1, pageSize: 25, total: 0, manifestDigest: digest, rows: [] };
}

function approvalWithOperationIds(count: number) {
  const approvedOperationIds = Array.from(
    { length: count },
    (_, index) => `operation:${index}`,
  );
  return {
    selectedOperationIds: approvedOperationIds,
    approvedOperationIds,
    dependencyOperationIds: [],
    rejectedOperationIds: [],
    selectedCount: count,
    dependencyCount: 0,
    rejectedCount: 0,
    manifestDigest: digest,
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
});

afterEach(cleanup);

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
      const slowPoll = new Promise<{ run: ReturnType<typeof readyRun> }>((resolve) => {
        finishPoll = resolve;
      });
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

  it("offers automatic import only for safe records", async () => {
    client.getLatestRun.mockResolvedValue({ run: readyRun() });

    render(<ActMigrationPage />);

    expect(
      await screen.findByText("42 safe operations ready"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 records need your review")).toBeInTheDocument();
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
        name: "Rebuild review from archive",
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
      await screen.findByRole("button", { name: "Import as new record" }),
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

  it("does not offer ambiguity decisions after import activity locks rebuilding", async () => {
    const run = readyRun({ canOrganize: false, reviewRequiredCount: 1 });
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
      screen.queryByRole("button", { name: "Import as new record" }),
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
      await screen.findByRole("button", { name: "Organize fetched records" }),
    );

    await waitFor(() =>
      expect(client.organizeRun).toHaveBeenCalledWith(extracted.runId),
    );
    expect(client.getRun).toHaveBeenCalledWith(extracted.runId);
    expect(
      await screen.findByText("42 safe operations ready"),
    ).toBeInTheDocument();
  });

  it("continues 25-operation batches until complete with one base request key", async () => {
    client.getLatestRun.mockResolvedValue({
      run: readyRun({ safeOperationCount: 52, reviewRequiredCount: 0 }),
    });
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(52));
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
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Existing non-empty fields will not be replaced",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Imported records are not automatically removed",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
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
        nextApplyCursor: 25,
      }),
    });
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(52));
    client.applyNext.mockResolvedValue(batchResult(50, false));

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume safe import" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, import safe records" }),
    );

    await waitFor(() => expect(client.applyNext).toHaveBeenCalledOnce());
    expect(client.applyNext.mock.calls[0][1]).toMatchObject({
      batchSize: 25,
      approvalRequestKey: `act-safe-${readyRun().runId}-${digest}`,
    });
    expect(client.applyNext.mock.calls[0][1]).not.toHaveProperty("cursor");
    expect(client.applyNext.mock.calls[0][1]).not.toHaveProperty(
      "approvedOperationIds",
    );
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
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(30));
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
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(30));
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
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, retry failed import" }),
    );

    await waitFor(() => expect(client.applyNext).toHaveBeenCalledOnce());
    expect(client.applyNext.mock.calls[0][1]).toMatchObject({
      approvalRequestKey: `act-safe-${readyRun().runId}-${digest}`,
      retryFailed: true,
    });
  });

  it("shows the server safety lock and does not retry act_apply_disabled", async () => {
    client.getLatestRun.mockResolvedValue({ run: readyRun() });
    client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(42));
    client.applyNext.mockRejectedValue(
      Object.assign(new Error("act_apply_disabled"), {
        code: "act_apply_disabled",
      }),
    );

    render(<ActMigrationPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Import safe records" }),
    );
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
