"use client";

import { type FormEvent, useMemo, useState } from "react";

import {
  importCategories,
  type ImportApplyResult,
  type ImportCategory,
  type ImportPreview,
  type ImportPreviewRow,
} from "@/features/import/act-types";

const categoryLabels: Record<ImportCategory, string> = {
  new: "New",
  change: "Changes",
  duplicate: "Duplicates",
  conflict: "Conflicts",
  error: "Errors",
};

function canApply(row: ImportPreviewRow) {
  return row.category === "new" || row.category === "change";
}

function RowCard({
  row,
  approved,
  onToggle,
}: {
  row: ImportPreviewRow;
  approved: boolean;
  onToggle: (rowId: string, approved: boolean) => void;
}) {
  const safe = canApply(row);
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="font-semibold text-slate-950">{row.record.contact}</p>
          <p className="text-sm text-slate-600">
            {row.record.company ?? "No organization"}
            {row.record.email ? ` · ${row.record.email}` : ""}
          </p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            CSV row {row.record.rowNumber}
            {row.matchReason !== "none"
              ? ` · matched by ${row.matchReason.replaceAll("_", " ")}`
              : ""}
          </p>
        </div>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">
          <input
            aria-label={`Approve CSV row ${row.record.rowNumber}`}
            checked={approved}
            className="size-4 accent-orange-600"
            disabled={!safe}
            onChange={(event) => onToggle(row.rowId, event.target.checked)}
            type="checkbox"
          />
          {safe ? "Approve" : "Review only"}
        </label>
      </div>

      {row.changes.length > 0 ? (
        <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
          {row.changes.map((change) => (
            <div className="rounded-lg bg-slate-50 p-3" key={change.field}>
              <dt className="font-semibold capitalize text-slate-700">
                {change.field}
              </dt>
              <dd className="mt-1 text-slate-600">
                <span className="line-through">
                  {change.before || "Empty"}
                </span>
                <span aria-hidden="true"> → </span>
                <span className="font-medium text-slate-950">
                  {change.after || "Empty"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {row.messages.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm font-medium text-amber-800">
          {row.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ActImportReview({
  initialPreview = null,
}: {
  initialPreview?: ImportPreview | null;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(initialPreview);
  const [activeCategory, setActiveCategory] =
    useState<ImportCategory>("new");
  const [approvedRowIds, setApprovedRowIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleRows = useMemo(
    () =>
      preview?.rows.filter((row) => row.category === activeCategory) ?? [],
    [activeCategory, preview],
  );

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/import/act/preview", {
        method: "POST",
        body: new FormData(form),
      });
      const body = (await response.json()) as
        | ImportPreview
        | { error?: string };
      if (!response.ok || !("runId" in body)) {
        setStatus(
          "error" in body && body.error
            ? body.error
            : "The CSV could not be previewed.",
        );
        return;
      }
      setPreview(body);
      setApprovedRowIds(new Set());
      setActiveCategory("new");
      setStatus("Preview ready. Review every category before applying.");
    } catch {
      setStatus("The CSV could not be previewed.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(rowId: string, approved: boolean) {
    setApprovedRowIds((current) => {
      const next = new Set(current);
      if (approved) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function approveAllSafe() {
    if (!preview) return;
    setApprovedRowIds(
      new Set(
        preview.rows
          .filter((row) => canApply(row))
          .map((row) => row.rowId),
      ),
    );
  }

  async function applyApproved() {
    if (!preview || approvedRowIds.size === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/import/act/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: preview.runId,
          approvedRowIds: [...approvedRowIds],
        }),
      });
      const body = (await response.json()) as
        | ImportApplyResult
        | { error?: string };
      if (!response.ok || !("appliedRowIds" in body)) {
        setStatus(
          "error" in body && body.error
            ? body.error
            : "The approved rows could not be applied.",
        );
        return;
      }
      setStatus(
        `${body.appliedRowIds.length} approved ${
          body.appliedRowIds.length === 1 ? "row was" : "rows were"
        } applied. No changes were sent to Act!.`,
      );
      setApprovedRowIds(new Set());
    } catch {
      setStatus("The approved rows could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6" aria-labelledby="act-import-heading">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold" id="act-import-heading">
          Upload Act! contacts
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Previewing stores only the review run. Contacts change only after
          you explicitly approve and apply safe rows.
        </p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={createPreview}
        >
          <label className="grid flex-1 gap-1 text-sm font-semibold text-slate-700">
            Act! CSV file
            <input
              accept=".csv,text/csv"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:font-semibold"
              name="file"
              required
              type="file"
            />
          </label>
          <button
            className="min-h-11 rounded-lg bg-slate-950 px-5 py-2 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? "Working…" : "Preview CSV"}
          </button>
        </form>
      </div>

      {preview ? (
        <div className="grid gap-4">
          <div
            aria-label="Import categories"
            className="flex gap-2 overflow-x-auto pb-1"
            role="tablist"
          >
            {importCategories.map((category) => (
              <button
                aria-controls={`import-panel-${category}`}
                aria-selected={activeCategory === category}
                className="min-h-11 shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 aria-selected:border-orange-600 aria-selected:bg-orange-50 aria-selected:text-orange-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                id={`import-tab-${category}`}
                key={category}
                onClick={() => setActiveCategory(category)}
                role="tab"
                type="button"
              >
                {categoryLabels[category]} {preview.summary[category]}
              </button>
            ))}
          </div>

          <div
            aria-labelledby={`import-tab-${activeCategory}`}
            id={`import-panel-${activeCategory}`}
            role="tabpanel"
          >
            {visibleRows.length > 0 ? (
              <ul className="grid gap-3">
                {visibleRows.map((row) => (
                  <RowCard
                    approved={approvedRowIds.has(row.rowId)}
                    key={row.rowId}
                    onToggle={toggleRow}
                    row={row}
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
                No rows in this category.
              </p>
            )}
          </div>

          <div className="sticky bottom-20 z-[1] flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between md:bottom-4">
            <div>
              <p aria-live="polite" className="font-bold text-slate-950">
                {approvedRowIds.size}{" "}
                {approvedRowIds.size === 1 ? "row" : "rows"} selected for apply
              </p>
              <p className="text-sm text-slate-600">
                Conflicts, duplicates, and errors remain review-only.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                onClick={approveAllSafe}
                type="button"
              >
                Approve All Safe Changes
              </button>
              <button
                className="min-h-11 rounded-lg bg-orange-600 px-5 py-2 font-semibold text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || approvedRowIds.size === 0}
                onClick={applyApproved}
                type="button"
              >
                Apply {approvedRowIds.size} approved
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {status ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700"
        >
          {status}
        </p>
      ) : null}
    </section>
  );
}
