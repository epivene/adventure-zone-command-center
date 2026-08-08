import { useEffect, useState } from "react";
import { ExtractionProgress } from "@/components/act-replacement/extraction-progress";
import { ImportReview } from "@/components/act-replacement/import-review";
import { ImportSummary } from "@/components/act-replacement/import-summary";
import {
  ACT_PAGE_SIZES,
  applyNext,
  approveSafeDefaults,
  decideReviewRecord,
  getLatestRun,
  getReview,
  getRun,
  organizeRun,
  resumeRun,
  startRun,
  supersedeRun,
  type ActPageSize,
  type ActReplacementWorkflowStatus,
  type ReviewPage,
  type ReviewRow,
} from "@/features/act-replacement/act-replacement-client";

const stages = ["Fetch", "Organize", "Review", "Import", "Finish"] as const;
const APPLY_BATCH_SIZE = 25;

type SessionTotals = {
  applied: number;
  alreadyPresent: number;
  blocked: number;
  failed: number;
};

const emptyTotals: SessionTotals = {
  applied: 0,
  alreadyPresent: 0,
  blocked: 0,
  failed: 0,
};

function isFinished(phase: ActReplacementWorkflowStatus["phase"]) {
  return ["complete", "complete_with_issues", "failed", "superseded"].includes(
    phase,
  );
}

function activeStage(
  run: ActReplacementWorkflowStatus | null,
  applying: boolean,
) {
  if (applying) return 3;
  if (!run || run.phase === "extracting" || run.phase === "superseded")
    return 0;
  if (run.phase === "extract_complete" || run.phase === "organizing") return 1;
  if (run.phase === "ready_to_apply") return 2;
  if (run.phase === "applying") return 3;
  return 4;
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : null;
}

function safeImportRequestKey(run: ActReplacementWorkflowStatus) {
  return `act-safe-${run.runId}-${run.manifestDigest}`;
}

function StageProgress({ active }: { active: number }) {
  return (
    <nav aria-label="Act import stages" className="mt-6">
      <ol className="grid grid-cols-5 gap-1">
        {stages.map((stage, index) => (
          <li
            key={stage}
            aria-current={index === active ? "step" : undefined}
            className={`rounded-lg px-2 py-2 text-center text-xs font-semibold sm:text-sm ${
              index === active
                ? "bg-orange-600 text-white"
                : index < active
                  ? "bg-green-100 text-green-800"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {stage}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function ActMigrationPage() {
  const [run, setRun] = useState<ActReplacementWorkflowStatus | null>(null);
  const [pageSize, setPageSize] = useState<ActPageSize>(100);
  const [review, setReview] = useState<ReviewPage | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewRevision, setReviewRevision] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [resolvingSourceRecordId, setResolvingSourceRecordId] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "fetch" | "organize" | "apply" | "review" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [applyLocked, setApplyLocked] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [sessionTotals, setSessionTotals] =
    useState<SessionTotals>(emptyTotals);

  useEffect(() => {
    let current = true;
    void getLatestRun()
      .then((result) => {
        if (current) setRun(result.run);
      })
      .catch((caught) => {
        if (current)
          setError(errorCode(caught) ?? "Could not load import status");
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!run || !["extracting", "organizing"].includes(run.phase)) return;
    const runId = run.runId;
    const poll = setInterval(() => {
      void getRun(runId)
        .then((result) => setRun(result.run))
        .catch((caught) =>
          setError(errorCode(caught) ?? "Could not refresh import status"),
        );
    }, 3000);
    return () => clearInterval(poll);
  }, [run?.phase, run?.runId]);

  useEffect(() => {
    if (!run?.manifestDigest) {
      setReview(null);
      return;
    }
    let current = true;
    setReviewLoading(true);
    void getReview(run.runId, {
      page: reviewPage,
      pageSize: 25,
      search: reviewSearch,
      state: "needs_review",
    })
      .then((result) => {
        if (current) setReview(result);
      })
      .catch((caught) => {
        if (current)
          setError(errorCode(caught) ?? "Could not load review records");
      })
      .finally(() => {
        if (current) setReviewLoading(false);
      });
    return () => {
      current = false;
    };
  }, [run?.manifestDigest, run?.runId, reviewPage, reviewRevision, reviewSearch]);

  const refreshRun = async (runId: string) => {
    const result = await getRun(runId);
    setRun(result.run);
    return result.run;
  };

  const runStatusAction = async (
    action: () => Promise<{ run: ActReplacementWorkflowStatus }>,
  ) => {
    setBusy("fetch");
    setError(null);
    try {
      setRun((await action()).run);
    } catch (caught) {
      setError(errorCode(caught) ?? "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const start = () => void runStatusAction(() => startRun(pageSize));

  const startOver = () => {
    if (window.prompt("Type START OVER to confirm") === "START OVER" && run) {
      void runStatusAction(() => supersedeRun(run.runId));
    }
  };

  const organize = async () => {
    if (!run) return;
    setBusy("organize");
    setError(null);
    try {
      await organizeRun(run.runId);
      await refreshRun(run.runId);
      setReviewPage(1);
    } catch (caught) {
      setError(errorCode(caught) ?? "Could not organize fetched records");
    } finally {
      setBusy(null);
    }
  };

  const importSafeRecords = async () => {
    if (!run?.manifestDigest || applyLocked) return;
    setShowConfirmation(false);
    setBusy("apply");
    setError(null);
    setNeedsAttention(false);
    const totals: SessionTotals = {
      applied: run.appliedOperationCount,
      alreadyPresent: run.alreadyPresentOperationCount,
      blocked: run.blockedOperationCount,
      failed: run.failedOperationCount,
    };
    setSessionTotals(totals);

    try {
      const requestKey = safeImportRequestKey(run);
      const approval = await approveSafeDefaults(
        run.runId,
        run.manifestDigest,
        requestKey,
      );
      let cursor = run.nextApplyCursor;
      setRun((current) =>
        current ? { ...current, phase: "applying" } : current,
      );

      for (;;) {
        const result = await applyNext(run.runId, {
          expectedManifestDigest: approval.manifestDigest,
          approvalRequestKey: requestKey,
          batchSize: APPLY_BATCH_SIZE,
          ...(retryingFailed ? { retryFailed: true } : {}),
        });
        totals.applied += result.batch.completedCount;
        totals.alreadyPresent += result.batch.alreadyPresentCount;
        totals.blocked += result.batch.blockedCount;
        totals.failed += result.batch.failedCount;
        setSessionTotals({ ...totals });

        if (result.requiresReview) {
          setNeedsAttention(true);
          await refreshRun(run.runId);
          return;
        }
        if (!result.hasMore) {
          await refreshRun(run.runId);
          return;
        }
        if (result.nextCursor <= cursor) {
          throw new Error("apply_cursor_stalled");
        }
        cursor = result.nextCursor;
      }
    } catch (caught) {
      if (errorCode(caught) === "act_apply_disabled") {
        setApplyLocked(true);
        setError("Live import is still safely locked on the server");
      } else {
        setError(errorCode(caught) ?? "Safe import could not continue");
      }
    } finally {
      setRetryingFailed(false);
      setBusy(null);
    }
  };

  const importAmbiguousAsNew = async (row: ReviewRow) => {
    if (!run?.canOrganize || resolvingSourceRecordId || busy !== null) return;
    setResolvingSourceRecordId(row.sourceRecordId);
    setBusy("review");
    setError(null);
    try {
      // The decision endpoint saves the version-bound decision and atomically
      // rebuilds the manifest from the existing archive.
      await decideReviewRecord(run.runId, row.sourceRecordId, {
        sourceVersionId: row.sourceVersionId,
        scope: "duplicate_identity",
        decision: "keep_separate",
      });
      await refreshRun(run.runId);
      setReviewPage(1);
      setReviewRevision((current) => current + 1);
    } catch (caught) {
      setError(errorCode(caught) ?? "Could not save the review decision");
    } finally {
      setResolvingSourceRecordId(null);
      setBusy(null);
    }
  };

  const reviewIssues = async () => {
    if (!run) return;
    setBusy("review");
    setError(null);
    try {
      await refreshRun(run.runId);
      setReviewPage(1);
      setReviewSearch("");
      setNeedsAttention(false);
    } catch (caught) {
      setError(errorCode(caught) ?? "Could not refresh review status");
    } finally {
      setBusy(null);
    }
  };

  const stage = activeStage(run, busy === "apply");
  const canStart = !run || isFinished(run.phase);
  const showReview = Boolean(run?.manifestDigest);
  const showSummary = Boolean(
    run?.manifestDigest &&
    (stage >= 3 ||
      run.appliedOperationCount > 0 ||
      run.blockedOperationCount > 0 ||
      run.failedOperationCount > 0),
  );
  const appliedTotal = Math.max(
    run?.appliedOperationCount ?? 0,
    sessionTotals.applied,
  );
  const blockedTotal = Math.max(
    run?.blockedOperationCount ?? 0,
    sessionTotals.blocked,
  );
  const failedTotal = Math.max(
    run?.failedOperationCount ?? 0,
    sessionTotals.failed,
  );
  const alreadyPresentTotal = Math.max(
    run?.alreadyPresentOperationCount ?? 0,
    sessionTotals.alreadyPresent,
  );
  const durableNeedsAttention = Boolean(
    run?.phase === "complete_with_issues" &&
      (run.blockedOperationCount > 0 || run.failedOperationCount > 0),
  );
  const requiresAttention = needsAttention || durableNeedsAttention;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-12">
      <h1 className="mt-8 text-2xl font-bold text-slate-900">
        Import everything from Act!
      </h1>
      <p className="mt-2 text-slate-600">
        Fetch and organize the archive, review anything uncertain, then import
        only the records that are safe by default.
      </p>

      <StageProgress active={stage} />

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {run && (
        <ExtractionProgress
          status={run}
          onResume={() => void runStatusAction(() => resumeRun(run.runId))}
          onStartOver={startOver}
        />
      )}

      {run?.canOrganize && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
            Organize
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">
            {run.phase === "extract_complete"
              ? "Prepare the archived records for review"
              : "Rebuild the review from the saved archive"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This builds a durable review manifest without changing any profile.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void organize()}
            className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "organize"
              ? "Organizing…"
              : run.phase === "extract_complete"
                ? "Organize fetched records"
                : "Rebuild review from archive"}
          </button>
        </section>
      )}

      {showReview && run && (
        <ImportReview
          safeOperationCount={run.safeOperationCount}
          reviewRequiredCount={run.reviewRequiredCount}
          review={review}
          loading={reviewLoading}
          canResolveAmbiguous={run.canOrganize}
          canImport={
            run.canApplySafe && busy === null && !applyLocked && !requiresAttention
          }
          importLabel={
            run.phase === "applying" || run.nextApplyCursor > 0
              ? "Resume safe import"
              : "Import safe records"
          }
          onSearch={(search) => {
            setReviewPage(1);
            setReviewSearch(search);
          }}
          onPageChange={setReviewPage}
          onImportAsNew={(row) => void importAmbiguousAsNew(row)}
          resolvingSourceRecordId={resolvingSourceRecordId}
          onImport={() => {
            setRetryingFailed(false);
            setShowConfirmation(true);
          }}
        />
      )}

      {requiresAttention && (
        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">
            Automatic import stopped safely
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            A blocked or failed operation needs review before another attempt.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void reviewIssues()}
            className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            Review issues before retrying
          </button>
          {Boolean(run?.failedOperationCount) && (
            <button
              type="button"
              disabled={busy !== null || applyLocked}
              onClick={() => {
                setRetryingFailed(true);
                setShowConfirmation(true);
              }}
              className="mt-3 ml-2 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Retry failed import
            </button>
          )}
        </section>
      )}

      {showSummary && run && (
        <ImportSummary
          applied={appliedTotal}
          alreadyPresent={alreadyPresentTotal}
          blocked={blockedTotal}
          failed={failedTotal}
          remainingReview={run.reviewRequiredCount}
        />
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Advanced settings
          </summary>
          <label
            className="mt-4 block text-sm font-medium text-slate-700"
            htmlFor="batch-size"
          >
            Batch size
          </label>
          <select
            id="batch-size"
            value={pageSize}
            onChange={(event) =>
              setPageSize(Number(event.target.value) as ActPageSize)
            }
            disabled={Boolean(run && !isFinished(run.phase))}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ACT_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          {run && !isFinished(run.phase) && (
            <p className="mt-2 text-xs text-slate-500">
              Active run batch size is fixed at {run.pageSize}.
            </p>
          )}
        </details>
        {canStart && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={start}
            className="mt-5 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "fetch" ? "Starting…" : "Import everything from Act!"}
          </button>
        )}
      </section>

      {showConfirmation && run && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-safe-import-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2
              id="confirm-safe-import-heading"
              className="text-xl font-semibold text-slate-900"
            >
              {retryingFailed ? "Retry failed import?" : "Import safe records?"}
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              Existing non-empty fields will not be replaced. Imported records
              are not automatically removed if you later revisit this archive.
            </p>
            <p className="mt-3 text-sm font-medium text-slate-900">
              {run.safeOperationCount.toLocaleString()} safe operations will be
              processed in batches of 25.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void importSafeRecords()}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {retryingFailed
                  ? "Yes, retry failed import"
                  : "Yes, import safe records"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
