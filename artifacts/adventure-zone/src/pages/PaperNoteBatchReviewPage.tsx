import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FilePenLine,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Link } from "wouter";

import { PaperNoteBatchPreflightDialog } from "@/components/paper-notes/paper-note-batch-preflight-dialog";
import { PaperNoteEntryNavigator } from "@/components/paper-notes/paper-note-entry-navigator";
import { PaperNoteEntryPanel } from "@/components/paper-notes/paper-note-entry-panel";
import { PaperNoteImportSummary } from "@/components/paper-notes/paper-note-import-summary";
import { PaperNoteSourceViewer } from "@/components/paper-notes/paper-note-source-viewer";
import {
  addManualPaperNoteEntry,
  archivePaperNoteBatch,
  deletePaperNotePage,
  getPaperNoteBatch,
  getPaperNotePageSource,
  importPaperNoteBatch,
  markPaperNotePageReviewedEmpty,
  preflightPaperNoteBatch,
  reorderPaperNotePages,
  rereadPaperNotePage,
  restorePaperNotePageSource,
  retryPaperNotePage,
  rotatePaperNotePage,
  startPaperNoteExtraction,
} from "@/features/paper-notes/paper-note-client";
import type { PaperNoteBatchPreflight } from "@/features/paper-notes/paper-note-types";

function nextRotation(value: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
  if (value === 0) return 90;
  if (value === 90) return 180;
  if (value === 180) return 270;
  return 0;
}

function progressLabel(stage: "prepare" | "segment" | "extract_entries" | "complete" | null) {
  if (stage === "prepare") return "Preparing photo";
  if (stage === "segment") return "Finding entries";
  if (stage === "extract_entries") return "Reading entries";
  if (stage === "complete") return "Reading complete";
  return null;
}

export default function PaperNoteBatchReviewPage({ batchId }: { batchId: string }) {
  const batch = useQuery({
    queryKey: ["paper-notes", "batch", batchId],
    queryFn: () => getPaperNoteBatch(batchId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "extracting" || status === "importing" ? 3000 : false;
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [manualByPage, setManualByPage] = useState<Record<string, string>>({});
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PaperNoteBatchPreflight | null>(null);
  const importRequestKey = useRef<string | null>(null);

  useEffect(() => {
    const entries = batch.data?.entries ?? [];
    if (!entries.length) {
      if (selectedEntryId !== null) setSelectedEntryId(null);
      return;
    }
    if (selectedEntryId && entries.some((entry) => entry.id === selectedEntryId)) return;
    const next = entries.find((entry) => entry.state === "needs_review")
      ?? entries.find((entry) => entry.state === "ready")
      ?? entries.find((entry) => entry.state === "approved")
      ?? entries[0];
    setSelectedEntryId(next?.id ?? null);
  }, [batch.data?.entries, selectedEntryId]);

  useEffect(() => {
    if (batch.data?.status === "imported" || batch.data?.status === "archived") {
      setPreflight(null);
    }
  }, [batch.data?.status]);

  const refreshBatch = useCallback(async () => {
    await batch.refetch();
  }, [batch]);

  async function action(key: string, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await work();
      await batch.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The paper-note batch could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function checkImportReadiness() {
    if (busy) return;
    setBusy("preflight");
    setError("");
    try {
      const result = await preflightPaperNoteBatch(batchId);
      setPreflight(result);
      if (!result.ready) await batch.refetch();
    } catch (caught) {
      await batch.refetch();
      setError(caught instanceof Error ? caught.message : "Could not check this paper-note batch.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    if (busy || !preflight?.ready) return;
    setBusy("import");
    setError("");
    try {
      importRequestKey.current ??= crypto.randomUUID();
      await importPaperNoteBatch(batchId, importRequestKey.current);
      setPreflight(null);
      await batch.refetch();
    } catch (caught) {
      setPreflight(null);
      await batch.refetch();
      setError(caught instanceof Error ? caught.message : "The paper-note import could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  if (batch.isLoading) return <div className="mx-auto max-w-4xl py-8 text-slate-500">Loading paper notes…</div>;
  if (batch.isError || !batch.data) {
    return (
      <div className="mx-auto max-w-4xl py-8">
        <p className="text-rose-800">Could not load this paper-note batch.</p>
        <Link className="mt-3 inline-block font-semibold text-orange-700" href="/settings/paper-notes">Back to Paper notes</Link>
      </div>
    );
  }

  const data = batch.data;
  const editable = data.status === "draft" || data.status === "failed";
  const uploaded = data.pages.length > 0 && data.pages.every((page) => page.status === "uploaded");
  const attentionCount = data.pages.filter((page) => page.status === "needs_retry").length;

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= data.pages.length) return;
    const ids = data.pages.map((page) => page.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await action("order", () => reorderPaperNotePages(batchId, ids));
  }

  async function saveManual(pageId: string) {
    const transcription = (manualByPage[pageId] ?? "").trim();
    if (!transcription) return;
    await action(`manual:${pageId}`, () => addManualPaperNoteEntry(batchId, pageId, transcription));
    setManualByPage((current) => ({ ...current, [pageId]: "" }));
  }

  async function rotateAndReread(pageId: string, rotationDegrees: 0 | 90 | 180 | 270) {
    const confirmed = window.confirm(
      "Re-reading this page will discard its extracted entries and any review corrections for this page. The original photo will be kept. Continue?",
    );
    if (!confirmed) return;
    await action(`reread:${pageId}`, () => rereadPaperNotePage(
      batchId,
      pageId,
      nextRotation(rotationDegrees),
    ));
  }

  return (
    <div className="mx-auto max-w-4xl pb-12">
      <Link className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-orange-700" href="/settings/paper-notes">
        <ArrowLeft className="h-4 w-4" /> Paper notes
      </Link>
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Paper notes batch</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">{data.name || "Untitled paper notes"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {data.status === "draft" ? "Check the saved pages, rotate them if needed, then read the notes." : null}
          {data.status === "queued" || data.status === "extracting" ? "Reading is in progress. You can leave this page; progress is saved." : null}
          {data.status === "review" && attentionCount === 0 ? `${data.needsReviewCount} entries need review.` : null}
          {data.status === "review" && attentionCount > 0 ? `${attentionCount} page${attentionCount === 1 ? "" : "s"} need attention before review is finished.` : null}
          {data.status === "importing" ? "Importing approved entries…" : null}
          {data.status === "imported" ? "This batch has been imported and its source pages are preserved." : null}
          {data.status === "archived" ? "This completed paper-note batch is archived; its source provenance is still preserved." : null}
          {data.status === "failed" ? "One or more pages need attention before reading can continue." : null}
        </p>
      </header>

      {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p> : null}

      {data.importSummary ? (
        <div className="mt-5">
          <PaperNoteImportSummary summary={data.importSummary} />
          {data.status === "imported" ? (
            <button
              className="mt-3 min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
              disabled={Boolean(busy)}
              onClick={() => void action("archive", () => archivePaperNoteBatch(batchId))}
              type="button"
            >
              {busy === "archive" ? "Archiving…" : "Archive completed batch"}
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">Pages</h2>
          <span className="text-sm font-semibold text-slate-500">{data.pages.length}/25</span>
        </div>
        <div className="mt-3 grid gap-3">
          {data.pages.map((page, index) => {
            const stage = progressLabel(page.currentStage);
            const manualValue = manualByPage[page.id] ?? "";
            const rereadable = !["imported", "archived", "importing"].includes(data.status)
              && ["extracted", "needs_retry", "reviewed_empty"].includes(page.status);
            const manualEditable = (data.status === "review" || data.status === "failed")
              && (page.status === "needs_retry" || page.status === "extracted");
            return (
              <article className="rounded-xl border border-slate-200 bg-white p-4" key={page.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{index + 1}. {page.originalFilename}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {page.status.replaceAll("_", " ")} · rotation {page.rotationDegrees}°
                      {page.width && page.height ? ` · ${page.width}×${page.height}` : ""}
                    </p>
                    {stage && (page.status === "queued" || page.status === "extracting") ? (
                      <p className="mt-2 text-sm font-semibold text-orange-800">{stage}</p>
                    ) : null}
                    {page.pageHeading ? <p className="mt-2 text-sm text-slate-700">Page heading: {page.pageHeading}</p> : null}
                    {page.pageActivityDate ? <p className="mt-1 text-sm text-slate-700">Historical page date: {page.pageActivityDate}</p> : null}
                  </div>
                  {editable ? (
                    <div className="flex flex-wrap gap-1">
                      <button aria-label={`Move page ${index + 1} up`} className="min-h-11 min-w-11 rounded-lg border border-slate-200" disabled={Boolean(busy) || index === 0} onClick={() => void move(index, -1)} type="button"><ChevronUp className="mx-auto h-4 w-4" /></button>
                      <button aria-label={`Move page ${index + 1} down`} className="min-h-11 min-w-11 rounded-lg border border-slate-200" disabled={Boolean(busy) || index === data.pages.length - 1} onClick={() => void move(index, 1)} type="button"><ChevronDown className="mx-auto h-4 w-4" /></button>
                      <button aria-label={`Rotate page ${index + 1}`} className="min-h-11 min-w-11 rounded-lg border border-slate-200" disabled={Boolean(busy)} onClick={() => void action(page.id, () => rotatePaperNotePage(batchId, page.id, nextRotation(page.rotationDegrees)))} type="button"><RotateCw className="mx-auto h-4 w-4" /></button>
                      <button aria-label={`Delete page ${index + 1}`} className="min-h-11 min-w-11 rounded-lg border border-rose-200 text-rose-700" disabled={Boolean(busy)} onClick={() => void action(page.id, () => deletePaperNotePage(batchId, page.id))} type="button"><Trash2 className="mx-auto h-4 w-4" /></button>
                    </div>
                  ) : null}
                </div>

                {page.status !== "uploading" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <PaperNoteSourceViewer
                      label={`Page ${index + 1}`}
                      loadSource={() => getPaperNotePageSource(batchId, page.id)}
                      restoreSource={(file) => restorePaperNotePageSource(batchId, page.id, file).then(() => undefined)}
                    />
                    {rereadable ? (
                      <button
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                        disabled={Boolean(busy)}
                        onClick={() => void rotateAndReread(page.id, page.rotationDegrees)}
                        type="button"
                      >
                        <RotateCw className="h-4 w-4" />
                        {busy === `reread:${page.id}` ? "Re-reading…" : "Rotate & re-read"}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {page.status === "needs_retry" ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-950">This page needs attention</p>
                    <p className="mt-1 text-sm text-amber-900">
                      {page.lastErrorMessage || "The handwriting reader could not finish this page."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                        disabled={Boolean(busy)}
                        onClick={() => void action(`retry:${page.id}`, () => retryPaperNotePage(batchId, page.id))}
                        type="button"
                      >
                        <RefreshCw className="h-4 w-4" /> {busy === `retry:${page.id}` ? "Queueing…" : "Retry reading"}
                      </button>
                      <button
                        className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                        disabled={Boolean(busy)}
                        onClick={() => void action(`empty:${page.id}`, () => markPaperNotePageReviewedEmpty(batchId, page.id))}
                        type="button"
                      >
                        No importable entries
                      </button>
                    </div>
                  </div>
                ) : null}

                {manualEditable ? (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <label className="grid gap-2 text-sm font-semibold text-slate-800" htmlFor={`manual-${page.id}`}>
                        Add an entry manually
                        <textarea
                          className="min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                          id={`manual-${page.id}`}
                          maxLength={12_000}
                          onChange={(event) => setManualByPage((current) => ({ ...current, [page.id]: event.target.value }))}
                          placeholder="Type only what you can read from this paper entry. You can structure and match it on the next review screen."
                          value={manualValue}
                        />
                      </label>
                      <button
                        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                        disabled={!manualValue.trim() || Boolean(busy)}
                        onClick={() => void saveManual(page.id)}
                        type="button"
                      >
                        <FilePenLine className="h-4 w-4" /> {busy === `manual:${page.id}` ? "Saving…" : "Save manual entry"}
                      </button>
                    </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {editable ? (
        <button
          className="mt-6 min-h-12 w-full rounded-xl bg-orange-600 px-4 py-3 text-base font-bold text-white hover:bg-orange-700 disabled:opacity-50"
          disabled={!uploaded || Boolean(busy)}
          onClick={() => void action("extract", () => startPaperNoteExtraction(batchId))}
          type="button"
        >
          {busy === "extract" ? "Starting…" : "Read Paper Notes"}
        </button>
      ) : null}
      {editable && !uploaded ? <p className="mt-2 text-center text-sm text-slate-500">All retained photos must finish uploading first.</p> : null}

      {data.entries.length ? (
        <section className="mt-8 border-t border-slate-200 pt-7">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Review</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-950">Review extracted entries</h2>
              <p className="mt-1 text-sm text-slate-600">Correct what the paper says, choose where it belongs, then approve it. Nothing is written to the CRM yet.</p>
            </div>
            <div className="text-right text-xs font-semibold text-slate-500">
              <p>{data.needsReviewCount} need review · {data.readyCount} ready</p>
              <p>{data.approvedCount} approved · {data.skippedCount} skipped</p>
            </div>
          </div>
          {selectedEntryId ? (
            <>
              <PaperNoteEntryNavigator
                entries={data.entries}
                selectedId={selectedEntryId}
                onSelect={setSelectedEntryId}
              />
              <div className="mt-4">
                <PaperNoteEntryPanel
                  entryId={selectedEntryId}
                  onChanged={refreshBatch}
                />
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {data.status === "review" && data.entries.length ? (
        <section className="mt-8 rounded-2xl border border-orange-200 bg-orange-50 p-5">
          <h2 className="text-xl font-bold text-orange-950">Ready to import?</h2>
          <p className="mt-1 text-sm text-orange-900">The server will re-check every page and entry first. CRM records are still unchanged.</p>
          <button
            className="mt-4 min-h-12 rounded-xl bg-orange-600 px-4 py-3 font-bold text-white disabled:opacity-50"
            disabled={Boolean(busy)}
            onClick={() => void checkImportReadiness()}
            type="button"
          >
            {busy === "preflight" ? "Checking…" : "Check import readiness"}
          </button>
        </section>
      ) : null}

      {preflight ? (
        <PaperNoteBatchPreflightDialog
          preflight={preflight}
          busy={busy === "import"}
          onClose={() => !busy && setPreflight(null)}
          onConfirm={() => void confirmImport()}
        />
      ) : null}
    </div>
  );
}
