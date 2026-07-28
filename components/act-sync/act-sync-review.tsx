"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  applyActSyncAction,
  createActSyncPreviewAction,
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

type Props = {
  configured: boolean;
  maskedDatabase: string | null;
  initialPreview: StoredSyncPreview | null;
  testConnectionAction?: typeof testActConnectionAction;
  createPreviewAction?: () => Promise<ActSyncActionResult>;
  applyAction?: (
    runId: string,
    decisions: readonly SyncApplyDecision[],
  ) => Promise<ActSyncApplyActionResult>;
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
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2"
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
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2"
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
  openPreview = (runId) => {
    window.location.assign(`/settings/act-sync?runId=${runId}`);
  },
}: Props) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] =
    useState<SyncComparisonCategory>("new_in_act");
  const [decisions, setDecisions] = useState<Map<string, DecisionState>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [applyProgress, setApplyProgress] =
    useState<BatchApplyProgress | null>(null);
  const [applySummary, setApplySummary] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [retryMode, setRetryMode] =
    useState<"failed" | "remaining" | null>(null);

  const visibleRows = useMemo(
    () =>
      initialPreview?.rows.filter(
        (row) => row.category === activeCategory,
      ) ?? [],
    [activeCategory, initialPreview],
  );
  const activeSafeDecision = safeDecisionForCategory(activeCategory);

  function setRowDecision(
    rowId: string,
    decision: DecisionState | undefined,
  ) {
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
    setApplySummary(null);
    setRetryMode(null);
  }

  function approveActiveCategory() {
    if (!initialPreview) return;
    const approved = decisionsForCategory(
      initialPreview.rows,
      activeCategory,
    );
    setDecisions(
      new Map(
        approved.map(({ rowId, ...decision }) => [rowId, decision]),
      ),
    );
    setRowErrors(new Map());
    setApplySummary(null);
    setRetryMode(null);
  }

  async function testConnection() {
    setBusy(true);
    setStatus(null);
    const result = await testConnectionAction();
    setStatus(result.ok ? "Act! connection successful." : result.error);
    setBusy(false);
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
    if (!initialPreview || decisions.size === 0) return;
    setBusy(true);
    setStatus(null);
    setApplySummary(null);
    setRowErrors(new Map());
    const input = [...decisions].map(([rowId, value]) => ({
      rowId,
      ...value,
    }));
    const rowsById = new Map(
      initialPreview.rows.map((row) => [row.rowId, row]),
    );
    const newActOnly = input.every(
      (decision) => rowsById.get(decision.rowId)?.category === "new_in_act",
    );

    const outcome = await applyDecisionsInBatches({
      runId: initialPreview.id,
      decisions: input,
      applyBatch: applyAction,
      onProgress: (progress) => {
        setApplyProgress(progress);
        setDecisions((current) => {
          const next = new Map(current);
          progress.completedRowIds.forEach((rowId) => next.delete(rowId));
          return next;
        });
      },
    });
    const retryDecisions = [
      ...outcome.failed.map((failure) => failure.decision),
      ...outcome.pending,
    ];
    setDecisions(
      new Map(
        retryDecisions.map(({ rowId, ...decision }) => [rowId, decision]),
      ),
    );
    setRowErrors(
      new Map(
        outcome.failed.map((failure) => [
          failure.decision.rowId,
          failure.error,
        ]),
      ),
    );

    if (outcome.interruptedError) {
      setApplySummary(outcome.interruptedError);
      setRetryMode("remaining");
    } else if (outcome.failed.length > 0) {
      setApplySummary(
        newActOnly
          ? `${outcome.completed} imported · ${outcome.failed.length} ${
              outcome.failed.length === 1 ? "needs" : "need"
            } retry.`
          : `${outcome.completed} completed · ${outcome.failed.length} ${
              outcome.failed.length === 1 ? "needs" : "need"
            } retry.`,
      );
      setRetryMode("failed");
    } else {
      setApplySummary(
        newActOnly
          ? `${outcome.completed} contacts imported.`
          : `${outcome.completed} approved changes completed.`,
      );
      setRetryMode(null);
    }
    setApplyProgress(null);
    setBusy(false);
    router.refresh();
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
              className="button-secondary"
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
                className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 aria-selected:border-orange-600 aria-selected:bg-orange-50 aria-selected:text-orange-800"
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
                    disabled={busy}
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
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {activeSafeDecision && visibleRows.length > 0 ? (
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={approveActiveCategory}
                  type="button"
                >
                  Approve only {categoryLabels[activeCategory]} ({visibleRows.length})
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
