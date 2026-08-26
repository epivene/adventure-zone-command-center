import { useEffect, useState } from "react";

import { GoogleValidationReview } from "@/components/google-workspace/google-validation-review";
import { retryGoogleHistoricalFailures } from "@/features/google-workspace/google-historical-backfill-client";
import {
  approveFirstGoogleHistoricalBatch,
  getGoogleHistoricalBackfill,
  runNextGoogleHistoricalBatch,
  type GoogleHistoricalBackfillView,
  type GoogleHistoricalBatchResult,
} from "@/features/google-workspace/google-workspace-client";

function summaryFromBatch(batch: GoogleHistoricalBatchResult | null): string | null {
  if (!batch) return null;
  return `${batch.processed} processed · ${batch.attached} attached · ${batch.ignored} ignored · ${batch.needsReview} review · ${batch.failed} failed · ${batch.skipped} skipped`;
}

export function GoogleHistoricalBackfill() {
  const [view, setView] = useState<GoogleHistoricalBackfillView | null>(null);
  const [lastBatch, setLastBatch] = useState<GoogleHistoricalBatchResult | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [interruptedNotice, setInterruptedNotice] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [busy, setBusy] = useState<"run" | "approve" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload(): Promise<GoogleHistoricalBackfillView> {
    const next = await getGoogleHistoricalBackfill();
    setView(next);
    return next;
  }

  useEffect(() => {
    void reload().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Could not load historical Gmail status.");
    });
  }, []);

  async function runNext() {
    const processedBefore = view?.state.cumulative.processed ?? 0;
    setBusy("run");
    setError(null);
    setRetryNotice(null);
    setInterruptedNotice(null);
    try {
      const result = await runNextGoogleHistoricalBatch();
      setLastBatch(result);
      await reload();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not run historical Gmail batch.";
      try {
        const refreshed = await reload();
        if (refreshed.state.cumulative.processed > processedBefore) {
          setError(null);
          setInterruptedNotice(
            "Batch completed; the connection response was interrupted. Saved historical Gmail progress is intact.",
          );
        } else {
          setError(message);
        }
      } catch {
        setError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function approveFirst() {
    setBusy("approve");
    setError(null);
    try {
      const result = await approveFirstGoogleHistoricalBatch();
      setView((current) => current ? { ...current, state: result.state } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not approve the first historical batch.");
    } finally {
      setBusy(null);
    }
  }

  async function retryFailures() {
    setBusy("retry");
    setError(null);
    setRetryNotice(null);
    setInterruptedNotice(null);
    try {
      const result = await retryGoogleHistoricalFailures();
      setRetryNotice(
        `${result.attempted} retried · ${result.attached} attached · ${result.ignored} ignored · ${result.needsReview} review · ${result.failed} still failed`,
      );
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry failed historical email.");
    } finally {
      setBusy(null);
    }
  }

  async function historicalReviewCountChanged() {
    await reload().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Could not refresh historical Gmail counts.");
    });
  }

  if (!view) {
    return (
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/30">
        <h2 className="font-bold text-slate-900 dark:text-slate-100">Historical Gmail backfill</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {error ?? "Loading historical Gmail status…"}
        </p>
      </section>
    );
  }

  const { state } = view;
  const retryingFirst = state.status === "error" && state.cumulative.processed === 0;
  const retryingLater =
    state.status === "error" &&
    state.firstBatchApproved &&
    state.cumulative.processed > 0;
  const canRunFirst =
    view.syncEnabled &&
    view.validationStatus === "approved" &&
    (state.status === "not_started" || retryingFirst);
  const canContinue =
    view.syncEnabled &&
    view.validationStatus === "approved" &&
    state.firstBatchApproved &&
    (state.status === "ready" || retryingLater);
  const canRetryFailures =
    view.syncEnabled &&
    view.validationStatus === "approved" &&
    state.cumulative.failed > 0;
  const awaitingApproval = state.status === "awaiting_approval";
  const cumulative = state.cumulative;

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950/20">
      <div>
        <h2 className="text-xl font-bold">Historical Gmail backfill</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Process Gmail history in controlled batches of 250 messages. The first batch always stops for your approval before anything older can continue.
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Gmail stays read-only. Spam and Trash are excluded. Google Calendar history is not part of this step.
        </p>
      </div>

      {!view.syncEnabled ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Historical Gmail is installed but the production sync gate is still off. No historical messages can run yet.
        </div>
      ) : null}
      {view.validationStatus !== "approved" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Approve the recent email validation sample before historical Gmail can run.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Processed", cumulative.processed],
          ["Attached", cumulative.attached],
          ["Ignored", cumulative.ignored],
          ["Review", cumulative.needsReview],
          ["Failed", cumulative.failed],
          ["Skipped", cumulative.skipped],
        ].map(([label, value]) => (
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900" key={label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {cumulative.needsReview > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                {cumulative.needsReview} historical email{cumulative.needsReview === 1 ? "" : "s"} need review
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Assign each email to the right profile or ignore it before approving the batch.
              </p>
            </div>
            <button
              aria-expanded={showReview}
              className="button-secondary px-4 py-2"
              onClick={() => setShowReview((current) => !current)}
              type="button"
            >
              {showReview ? "Hide review emails" : `Review ${cumulative.needsReview} email${cumulative.needsReview === 1 ? "" : "s"}`}
            </button>
          </div>
          {showReview ? (
            <div className="mt-3">
              <GoogleValidationReview onPendingCountChange={() => void historicalReviewCountChanged()} />
            </div>
          ) : null}
        </div>
      ) : null}

      {summaryFromBatch(lastBatch) ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {summaryFromBatch(lastBatch)}
        </p>
      ) : null}
      {retryNotice ? (
        <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          {retryNotice}
        </p>
      ) : null}
      {interruptedNotice ? (
        <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          {interruptedNotice}
        </p>
      ) : null}

      {awaitingApproval ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/30">
          <p className="font-bold text-orange-900 dark:text-orange-200">First 250 are parked for review</p>
          <p className="mt-1 text-sm text-orange-800 dark:text-orange-300">
            Review the profile matches and Needs Review queue. Nothing older will run until you approve this first historical batch. You can leave this page and come back later; the batch stays parked.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="button-primary px-4 py-2" disabled={busy !== null || cumulative.needsReview > 0} onClick={() => void approveFirst()} type="button">
              {busy === "approve" ? "Approving…" : cumulative.needsReview > 0 ? `Resolve ${cumulative.needsReview} review email${cumulative.needsReview === 1 ? "" : "s"} first` : "Approve first batch"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canRunFirst ? (
          <button className="button-primary px-4 py-2" disabled={busy !== null} onClick={() => void runNext()} type="button">
            {busy === "run"
              ? "Processing first 250…"
              : retryingFirst
                ? "Retry first 250"
                : "Run first 250"}
          </button>
        ) : null}
        {canContinue ? (
          <button className="button-primary px-4 py-2" disabled={busy !== null} onClick={() => void runNext()} type="button">
            {busy === "run"
              ? "Processing next 250…"
              : retryingLater
                ? "Retry current 250"
                : "Continue next 250"}
          </button>
        ) : null}
        {canRetryFailures ? (
          <button className="button-secondary px-4 py-2" disabled={busy !== null} onClick={() => void retryFailures()} type="button">
            {busy === "retry" ? "Retrying failed messages…" : "Retry failed messages"}
          </button>
        ) : null}
      </div>

      {state.status === "error" ? (
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          This batch stopped before its cursor advanced. Reconnect Google if needed, then retry the same 250 safely.
        </p>
      ) : null}
      {state.status === "complete" ? (
        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Historical Gmail backfill reached the end of the mailbox.</p>
      ) : null}
      {error ? <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p> : null}
    </section>
  );
}
