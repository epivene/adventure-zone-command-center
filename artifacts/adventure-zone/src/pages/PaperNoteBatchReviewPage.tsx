import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, RotateCw, Trash2 } from "lucide-react";
import { Link } from "wouter";

import {
  deletePaperNotePage,
  getPaperNoteBatch,
  reorderPaperNotePages,
  rotatePaperNotePage,
  startPaperNoteExtraction,
} from "@/features/paper-notes/paper-note-client";

function nextRotation(value: 0 | 90 | 180 | 270): 0 | 90 | 180 | 270 {
  if (value === 0) return 90;
  if (value === 90) return 180;
  if (value === 180) return 270;
  return 0;
}

export default function PaperNoteBatchReviewPage({ batchId }: { batchId: string }) {
  const batch = useQuery({
    queryKey: ["paper-notes", "batch", batchId],
    queryFn: () => getPaperNoteBatch(batchId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "extracting" ? 3000 : false;
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

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

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= data.pages.length) return;
    const ids = data.pages.map((page) => page.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await action("order", () => reorderPaperNotePages(batchId, ids));
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
          {data.status === "queued" || data.status === "extracting" ? "Reading is queued. You can leave this page; progress is saved." : null}
          {data.status === "review" ? `${data.needsReviewCount} entries need review.` : null}
          {data.status === "imported" ? "This batch has been imported and its source pages are preserved." : null}
          {data.status === "failed" ? "One or more pages need attention before reading can continue." : null}
        </p>
      </header>

      {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p> : null}

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">Pages</h2>
          <span className="text-sm font-semibold text-slate-500">{data.pages.length}/25</span>
        </div>
        <div className="mt-3 grid gap-3">
          {data.pages.map((page, index) => (
            <article className="rounded-xl border border-slate-200 bg-white p-4" key={page.id}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{index + 1}. {page.originalFilename}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {page.status.replaceAll("_", " ")} · rotation {page.rotationDegrees}°
                    {page.width && page.height ? ` · ${page.width}×${page.height}` : ""}
                  </p>
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
            </article>
          ))}
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
    </div>
  );
}
