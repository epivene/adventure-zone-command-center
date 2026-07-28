"use client";

import { useMemo, useRef, useState } from "react";

import {
  applyActSyncAction,
  clearActSyncStagedDecisionsAction,
  createActSyncPreviewAction,
  stageActSyncDecisionsAction,
  testActConnectionAction,
  type ActSyncApplyActionResult,
  type ActSyncActionResult,
} from "@/app/(private)/settings/act-sync/actions";
import type { StoredSyncPreview } from "@/features/act-sync/sync-repository";
import {
  decisionsForCategory,
  safeDecisionForCategory,
} from "@/features/act-sync/category-approval";
import {
  applyDecisionsInBatches,
  type BatchApplyProgress,
} from "@/features/act-sync/apply-decisions-in-batches";
import {
  syncComparisonCategories,
  type SyncComparisonCategory,
  type SyncComparisonRow,
  type SyncDecision,
} from "@/features/act-sync/sync-comparison";
import type { SyncApplyDecision } from "@/features/act-sync/sync-service";

const categoryLabels: Record<SyncComparisonCategory, string> = {
  new_in_act: "New in Act!",
  new_in_app: "New in app",
  changed_in_act: "Changed in Act!",
  changed_in_app: "Changed in app",
  changed_in_both: "Changed in both",
  possible_match: "Possible matches",
  already_matched: "Already matched",
  missing_from_act: "Missing from Act!",
  error: "Errors",
};

const decisionLabels: Record<SyncDecision, string> = {
  pull: "Use Act! version",
  push: "Send app version to Act!",
  keep_act: "Keep Act! version",
  keep_app: "Keep app version",
  link: "Link these contacts",
  keep_separate: "Keep separate",
  skip: "Skip",
};

type DecisionState = {
  decision: SyncDecision;
  localContactId?: string;
};

const applyingRecoveryMessage =
  "This contact is still being reconciled. Refresh before retrying.";

function hydrateReviewState(preview: StoredSyncPreview | null) {
  const decisions = new Map<string, DecisionState>();
  const settledRowIds = new Set<string>();
  const lockedRowIds = new Set<string>();
  const failedRowIds = new Set<string>();
  const rowErrors = new Map<string, string>();
  let hasApproved = false;
  let hasRetryableFailure = false;

  for (const operation of preview?.operations ?? []) {
    if (operation.status === "completed" || operation.status === "skipped") {
      settledRowIds.add(operation.rowId);
      lockedRowIds.add(operation.rowId);
    } else if (operation.status === "applying") {
      lockedRowIds.add(operation.rowId);
      rowErrors.set(operation.rowId, applyingRecoveryMessage);
    } else if (operation.status === "approved" && operation.decision) {
      decisions.set(operation.rowId, {
        decision: operation.decision,
        ...(operation.localContactId
          ? { localContactId: operation.localContactId }
          : {}),
      });
      hasApproved = true;
    } else if (operation.status === "failed") {
      failedRowIds.add(operation.rowId);
      if (operation.error) rowErrors.set(operation.rowId, operation.error);
      if (operation.retryable) {
        if (operation.decision) {
          decisions.set(operation.rowId, {
            decision: operation.decision,
            ...(operation.localContactId
              ? { localContactId: operation.localContactId }
              : {}),
          });
          hasRetryableFailure = true;
        }
      } else {
        lockedRowIds.add(operation.rowId);
      }
    }
  }

  return {
    decisions,
    failedRowIds,
    lockedRowIds,
    retryMode: hasApproved
      ? ("remaining" as const)
      : hasRetryableFailure
        ? ("failed" as const)
        : null,
    rowErrors,
    settledRowIds,
  };
}

function completedApplySummary({
  completed,
  newActOnly,
  skipped,
}: {
  completed: number;
  newActOnly: boolean;
  skipped: number;
}) {
  const parts: string[] = [];
  if (completed > 0) {
    parts.push(
      newActOnly
        ? `${completed} ${completed === 1 ? "contact" : "contacts"} imported`
        : `${completed} approved ${
            completed === 1 ? "change" : "changes"
          } completed`,
    );
  }
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return `${parts.join(" · ")}.`;
}

type Props = {
  configured: boolean;
  maskedDatabase: string | null;
  initialPreview: StoredSyncPreview | null;
  testConnectionAction?: typeof testActConnectionAction;
  createPreviewAction?: () => Promise<ActSyncActionResult>;
  applyAction?: (
    runId: string,
    decisions: readonly SyncApplyDecision[],
    queueToken?: string,
  ) => Promise<ActSyncApplyActionResult>;
  stageDecisionsAction?: (
    runId: string,
    decisions: readonly SyncApplyDecision[],
    context: {
      replaceExisting: boolean;
      queueToken: string | null;
    },
  ) => Promise<ActSyncActionResult>;
  clearStagedAction?: (
    runId: string,
    queueToken?: string,
  ) => Promise<ActSyncActionResult>;
  openPreview?: (runId: string) => void;
};

function contactName(row: SyncComparisonRow) {
  const snapshot = row.localSnapshot ?? row.actSnapshot;
  if (!snapshot) return "Contact unavailable";
  return (
    `${snapshot.firstName} ${snapshot.lastName}`.trim() ||
    snapshot.organizationName ||
    "Unnamed contact"
  );
}

function Snapshot({
  label,
  row,
  source,
}: {
  label: string;
  row: SyncComparisonRow;
  source: "local" | "act";
}) {
  const snapshot = source === "local" ? row.localSnapshot : row.actSnapshot;
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </h4>
      {snapshot ? (
        <dl className="mt-2 grid gap-1 text-sm">
          <div>
            <dt className="sr-only">Name</dt>
            <dd className="font-semibold">
              {snapshot.firstName} {snapshot.lastName}
            </dd>
          </div>
          <div>
            <dt className="sr-only">Organization</dt>
            <dd>{snapshot.organizationName ?? "No organization"}</dd>
          </div>
          <div>
            <dt className="sr-only">Email</dt>
            <dd className="break-all">{snapshot.email ?? "No email"}</dd>
          </div>
          <div>
            <dt className="sr-only">Phone</dt>
            <dd>{snapshot.phone ?? "No phone"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No record</p>
      )}
    </div>
  );
}

function SyncRow({
  disabled,
  error,
  row,
  selected,
  onDecision,
}: {
  disabled: boolean;
  error: string | undefined;
  row: SyncComparisonRow;
  selected: DecisionState | undefined;
  onDecision: (rowId: string, value: DecisionState | undefined) => void;
}) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-bold">{contactName(row)}</h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {row.matchReason === "none"
              ? categoryLabels[row.category]
              : `Matched by ${row.matchReason.replaceAll("_", " ")}`}
          </p>
        </div>
        {row.allowedDecisions.length ? (
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Decision
            <select
              aria-label={`Decision for ${row.rowId}`}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={disabled}
              onChange={(event) => {
                const decision = event.target.value as SyncDecision | "";
                onDecision(
                  row.rowId,
                  decision
                    ? {
                        decision,
                        localContactId:
                          decision === "link"
                            ? row.localContactId ??
                              row.candidateLocalContactIds[0]
                            : undefined,
                      }
                    : undefined,
                );
              }}
              value={selected?.decision ?? ""}
            >
              <option value="">Choose…</option>
              {row.allowedDecisions.map((decision) => (
                <option key={decision} value={decision}>
                  {decisionLabels[decision]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            No action needed
          </span>
        )}
      </div>

      {selected?.decision === "link" &&
      row.candidateLocalContactIds.length > 1 ? (
        <label className="mt-3 grid gap-1 text-sm font-semibold text-slate-700">
          Local contact to link
          <select
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onChange={(event) =>
              onDecision(row.rowId, {
                decision: "link",
                localContactId: event.target.value,
              })
            }
            value={selected.localContactId}
          >
            {row.candidateLocalContactIds.map((contactId, index) => (
              <option key={contactId} value={contactId}>
                Candidate {index + 1}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-2">
        <Snapshot label="Command Center" row={row} source="local" />
        <Snapshot label="Act!" row={row} source="act" />
      </div>

      {row.messages.length ? (
        <ul className="mt-3 grid gap-1 text-sm font-semibold text-amber-800">
          {row.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ActSyncReview({
  configured,
  maskedDatabase,
  initialPreview,
  testConnectionAction = testActConnectionAction,
  createPreviewAction = createActSyncPreviewAction,
  applyAction = applyActSyncAction,
  stageDecisionsAction,
  clearStagedAction,
  openPreview = (runId) => {
    window.location.assign(`/settings/act-sync?runId=${runId}`);
  },
}: Props) {
  const durableQueuePresent = useRef(
    initialPreview?.operations.some(
      (operation) =>
        operation.status === "approved" ||
        (operation.status === "failed" &&
          operation.retryable &&
          operation.decision !== null),
    ) ?? false,
  );
  const activeQueueToken = useRef(initialPreview?.activeQueueToken ?? null);
  const basePrepareBatch =
    stageDecisionsAction ??
    (applyAction === applyActSyncAction
      ? (runId: string, batch: readonly SyncApplyDecision[], context: {
          replaceExisting: boolean;
          queueToken: string | null;
        }) =>
          stageActSyncDecisionsAction(
            runId,
            batch,
            context.replaceExisting,
            context.queueToken ?? undefined,
          )
      : undefined);
  const clearQueue =
    clearStagedAction ??
    (applyAction === applyActSyncAction
      ? clearActSyncStagedDecisionsAction
      : undefined);
  const prepareBatch = basePrepareBatch
    ? async (
        runId: string,
        batch: readonly SyncApplyDecision[],
        context: {
          replaceExisting: boolean;
          queueToken: string | null;
        },
      ) => {
        const result = await basePrepareBatch(runId, batch, context);
        if (result.ok) {
          durableQueuePresent.current = true;
          if (result.queueToken) {
            activeQueueToken.current = result.queueToken;
          }
        }
        return result;
      }
    : undefined;
  const applyBatch = (
    runId: string,
    batch: readonly SyncApplyDecision[],
    context: { queueToken: string | null },
  ) =>
    context.queueToken
      ? applyAction(runId, batch, context.queueToken)
      : applyAction(runId, batch);
  const hydrated = useMemo(
    () => hydrateReviewState(initialPreview),
    [initialPreview],
  );
  const [activeCategory, setActiveCategory] =
    useState<SyncComparisonCategory>("new_in_act");
  const [decisions, setDecisions] = useState<Map<string, DecisionState>>(
    () => hydrated.decisions,
  );
  const [settledRowIds, setSettledRowIds] = useState<Set<string>>(
    () => hydrated.settledRowIds,
  );
  const [lockedRowIds, setLockedRowIds] = useState<Set<string>>(
    () => hydrated.lockedRowIds,
  );
  const [failedRowIds, setFailedRowIds] = useState<Set<string>>(
    () => hydrated.failedRowIds,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [applyProgress, setApplyProgress] =
    useState<BatchApplyProgress | null>(null);
  const [applySummary, setApplySummary] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(
    () => hydrated.rowErrors,
  );
  const [retryMode, setRetryMode] =
    useState<"failed" | "remaining" | null>(hydrated.retryMode);

  const visibleRows = useMemo(
    () =>
      initialPreview?.rows.filter(
        (row) => row.category === activeCategory,
      ) ?? [],
    [activeCategory, initialPreview],
  );
  const approvableVisibleRows = useMemo(
    () =>
      decisionsForCategory(
        visibleRows.filter(
          (row) =>
            !lockedRowIds.has(row.rowId) &&
            !failedRowIds.has(row.rowId),
        ),
        activeCategory,
      ),
    [activeCategory, failedRowIds, lockedRowIds, visibleRows],
  );
  const activeSafeDecision = safeDecisionForCategory(activeCategory);
  const failureLocations = useMemo(() => {
    if (!initialPreview || failedRowIds.size === 0) return null;
    const counts = new Map<SyncComparisonCategory, number>();
    for (const row of initialPreview.rows) {
      if (!failedRowIds.has(row.rowId)) continue;
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }
    const labels = syncComparisonCategories
      .filter((category) => counts.has(category))
      .map(
        (category) =>
          `${categoryLabels[category]} (${counts.get(category) ?? 0})`,
      );
    return labels.length ? `Needs attention: ${labels.join(", ")}.` : null;
  }, [failedRowIds, initialPreview]);

  async function clearDurableQueue() {
    if (
      !initialPreview ||
      !clearQueue ||
      !durableQueuePresent.current
    ) {
      return true;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = activeQueueToken.current
        ? await clearQueue(initialPreview.id, activeQueueToken.current)
        : await clearQueue(initialPreview.id);
      if (!result.ok) {
        setStatus(result.error);
        return false;
      }
      durableQueuePresent.current = false;
      activeQueueToken.current = null;
      return true;
    } catch {
      setStatus("The saved sync decisions could not be cleared. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setRowDecision(
    rowId: string,
    decision: DecisionState | undefined,
  ) {
    if (settledRowIds.has(rowId) || lockedRowIds.has(rowId)) return;
    if (!(await clearDurableQueue())) return;
    setDecisions((current) => {
      const next = new Map(current);
      if (decision) next.set(rowId, decision);
      else next.delete(rowId);
      return next;
    });
    setRowErrors((current) => {
      const next = new Map(current);
      next.delete(rowId);
      return next;
    });
    setFailedRowIds((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
    setApplySummary(null);
    setRetryMode(null);
  }

  async function approveActiveCategory() {
    if (!initialPreview) return;
    if (!(await clearDurableQueue())) return;
    const approved = decisionsForCategory(
      initialPreview.rows.filter(
        (row) =>
          !lockedRowIds.has(row.rowId) && !failedRowIds.has(row.rowId),
      ),
      activeCategory,
    );
    setDecisions(
      new Map(
        approved.map(({ rowId, ...decision }) => [rowId, decision]),
      ),
    );
    setApplySummary(null);
    setRetryMode(null);
  }

  async function testConnection() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await testConnectionAction();
      setStatus(result.ok ? "Act! connection successful." : result.error);
    } catch {
      setStatus("The Act! connection test was interrupted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createPreview() {
    setBusy(true);
    setStatus("Reading Act! contacts and preparing a review…");
    try {
      const result = await createPreviewAction();
      if (result.ok) {
        setStatus("Review ready. Opening it now…");
        openPreview(result.runId);
      } else {
        setStatus(result.error);
      }
    } catch {
      setStatus(
        "The Act! review could not be prepared. Your contacts were not changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyApproved() {
    if (!initialPreview) return;
    const input = [...decisions]
      .filter(([rowId]) => !lockedRowIds.has(rowId))
      .map(([rowId, value]) => ({
        rowId,
        decision: value.decision,
        ...(value.localContactId
          ? { localContactId: value.localContactId }
          : {}),
      }));
    if (input.length === 0) {
      setDecisions(new Map());
      return;
    }
    setBusy(true);
    setStatus(null);
    setApplySummary(null);
    const inputRowIds = new Set(input.map(({ rowId }) => rowId));
    setRowErrors((current) => {
      const next = new Map(current);
      inputRowIds.forEach((rowId) => next.delete(rowId));
      return next;
    });
    setFailedRowIds((current) => {
      const next = new Set(current);
      inputRowIds.forEach((rowId) => next.delete(rowId));
      return next;
    });
    const rowsById = new Map(
      initialPreview.rows.map((row) => [row.rowId, row]),
    );
    const newActOnly = input.every(
      (decision) => rowsById.get(decision.rowId)?.category === "new_in_act",
    );

    const outcome = await applyDecisionsInBatches({
      runId: initialPreview.id,
      decisions: input,
      prepareBatch,
      applyBatch,
      onProgress: (progress) => {
        setApplyProgress(progress);
        setSettledRowIds((current) => {
          const next = new Set(current);
          progress.settledRowIds.forEach((rowId) => next.add(rowId));
          return next;
        });
        setLockedRowIds((current) => {
          const next = new Set(current);
          progress.settledRowIds.forEach((rowId) => next.add(rowId));
          return next;
        });
        setDecisions((current) => {
          const next = new Map(current);
          progress.settledRowIds.forEach((rowId) => next.delete(rowId));
          return next;
        });
      },
    });
    const retryableFailures = outcome.failed.filter(
      (failure) => failure.retryable,
    );
    const retryDecisions = [
      ...retryableFailures.map((failure) => failure.decision),
      ...outcome.pending,
    ];
    durableQueuePresent.current = retryDecisions.length > 0;
    if (retryDecisions.length === 0) activeQueueToken.current = null;
    setDecisions(
      new Map(
        retryDecisions.map(({ rowId, ...decision }) => [rowId, decision]),
      ),
    );
    setRowErrors((current) => {
      const next = new Map(current);
      outcome.failed.forEach((failure) => {
        next.set(failure.decision.rowId, failure.error);
      });
      return next;
    });
    setFailedRowIds((current) => {
      const next = new Set(current);
      outcome.failed.forEach((failure) => {
        next.add(failure.decision.rowId);
      });
      return next;
    });
    setLockedRowIds((current) => {
      const next = new Set(current);
      outcome.failed
        .filter((failure) => !failure.retryable)
        .forEach((failure) => next.add(failure.decision.rowId));
      return next;
    });

    if (outcome.interruptedError) {
      setApplySummary(outcome.interruptedError);
      setRetryMode(retryDecisions.length > 0 ? "remaining" : null);
    } else if (outcome.failed.length > 0) {
      const skippedCopy =
        outcome.skipped > 0 ? ` · ${outcome.skipped} skipped` : "";
      const nonRetryableFailures =
        outcome.failed.length - retryableFailures.length;
      const failureCopy = [
        retryableFailures.length > 0
          ? `${retryableFailures.length} ${
              retryableFailures.length === 1 ? "needs" : "need"
            } retry`
          : null,
        nonRetryableFailures > 0
          ? `${nonRetryableFailures} ${
              nonRetryableFailures === 1 ? "needs" : "need"
            } a new preview`
          : null,
      ]
        .filter((value): value is string => value !== null)
        .join(" · ");
      setApplySummary(
        newActOnly
          ? `${outcome.completed} imported${skippedCopy} · ${failureCopy}.`
          : `${outcome.completed} completed${skippedCopy} · ${failureCopy}.`,
      );
      setRetryMode(retryableFailures.length > 0 ? "failed" : null);
    } else {
      setApplySummary(
        completedApplySummary({
          completed: outcome.completed,
          newActOnly,
          skipped: outcome.skipped,
        }),
      );
      setRetryMode(null);
    }
    setApplyProgress(null);
    setBusy(false);
  }

  return (
    <section className="grid gap-6" aria-labelledby="act-sync-heading">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold" id="act-sync-heading">
              Act! connection
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {configured
                ? "Connected settings found"
                : "Connection settings are not configured"}
              {maskedDatabase ? ` · Database ${maskedDatabase}` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="button-secondary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !configured}
              onClick={testConnection}
              type="button"
            >
              Test connection
            </button>
            <button
              className="button-primary"
              disabled={busy || !configured}
              onClick={createPreview}
              type="button"
            >
              {busy ? "Working…" : "Sync with Act!"}
            </button>
          </div>
        </div>
        <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-950">
          Sync with Act! creates a review only. It does not change either
          system.
        </p>
      </div>

      {initialPreview ? (
        <div className="grid gap-4">
          <div
            aria-label="Act sync categories"
            className="flex gap-2 overflow-x-auto pb-1"
            role="tablist"
          >
            {syncComparisonCategories.map((category) => (
              <button
                aria-controls={`sync-panel-${category}`}
                aria-selected={activeCategory === category}
                className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 aria-selected:border-orange-600 aria-selected:bg-orange-50 aria-selected:text-orange-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                id={`sync-tab-${category}`}
                key={category}
                onClick={() => setActiveCategory(category)}
                role="tab"
                type="button"
              >
                {categoryLabels[category]} {initialPreview.summary[category]}
              </button>
            ))}
          </div>

          <div
            aria-labelledby={`sync-tab-${activeCategory}`}
            id={`sync-panel-${activeCategory}`}
            role="tabpanel"
          >
            {visibleRows.length ? (
              <ul className="grid gap-3">
                {visibleRows.map((row) => (
                  <SyncRow
                    disabled={busy || lockedRowIds.has(row.rowId)}
                    error={rowErrors.get(row.rowId)}
                    key={row.rowId}
                    onDecision={setRowDecision}
                    row={row}
                    selected={decisions.get(row.rowId)}
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
                No contacts in this category.
              </p>
            )}
          </div>

          <div className="sticky bottom-20 z-[1] flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between md:bottom-4">
            <div>
              <p aria-live="polite" className="font-bold">
                {applyProgress
                  ? `Importing ${applyProgress.processed} of ${applyProgress.total}…`
                  : applySummary ??
                    `${decisions.size} ${
                      decisions.size === 1 ? "row" : "rows"
                    } approved`}
              </p>
              <p className="text-sm text-slate-600">
                Conflicts stay unselected until you choose what to keep.
              </p>
              {failureLocations ? (
                <p className="mt-1 text-sm font-semibold text-red-800">
                  {failureLocations}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {activeSafeDecision && approvableVisibleRows.length > 0 ? (
                <button
                  className="button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busy}
                  onClick={approveActiveCategory}
                  type="button"
                >
                  {`Approve only ${categoryLabels[activeCategory]} (${approvableVisibleRows.length})`}
                </button>
              ) : null}
              <button
                className="button-primary"
                disabled={busy || decisions.size === 0}
                onClick={applyApproved}
                type="button"
              >
                {retryMode === "failed"
                  ? "Retry failed contacts"
                  : retryMode === "remaining"
                    ? "Retry remaining contacts"
                    : `Apply ${decisions.size} approved`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {status ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700"
        >
          {status}
        </p>
      ) : null}
    </section>
  );
}
