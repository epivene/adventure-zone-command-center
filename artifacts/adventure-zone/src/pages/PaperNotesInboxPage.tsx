import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { PaperNoteBatchCard } from "@/components/paper-notes/paper-note-batch-card";
import { PaperNoteHealthBanner } from "@/components/paper-notes/paper-note-health-banner";
import { PaperNoteUploadPanel } from "@/components/paper-notes/paper-note-upload-panel";
import { listPaperNoteBatches } from "@/features/paper-notes/paper-note-client";
import { getPaperNoteHealth } from "@/features/paper-notes/paper-note-health-client";

export default function PaperNotesInboxPage() {
  const [, navigate] = useLocation();
  const batches = useQuery({
    queryKey: ["paper-notes", "batches"],
    queryFn: listPaperNoteBatches,
    refetchOnWindowFocus: true,
  });
  const health = useQuery({
    queryKey: ["paper-notes", "health"],
    queryFn: getPaperNoteHealth,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const active = (batches.data ?? []).filter((batch) => batch.status !== "imported" && batch.status !== "archived");
  const completed = (batches.data ?? []).filter((batch) => batch.status === "imported" || batch.status === "archived");

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <header className="mb-6">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Imports & Data</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Paper notes</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Photograph the old call sheets, check what they say, and choose exactly what belongs in Command Center before anything is imported.
        </p>
      </header>

      {health.data ? <PaperNoteHealthBanner health={health.data} /> : null}
      {health.isError ? (
        <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Paper Notes status could not be checked right now. Your saved batches are still available.
        </p>
      ) : null}

      <PaperNoteUploadPanel onUploaded={(batchId) => navigate(`/settings/paper-notes/${batchId}`)} />

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">In review</h2>
          {batches.isFetching ? <span className="text-xs font-semibold text-slate-500">Updating…</span> : null}
        </div>
        {batches.isError ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm text-rose-800">Could not load paper-note imports.</p>
            <button className="mt-2 min-h-11 rounded-lg border border-rose-300 bg-white px-3 text-sm font-bold text-rose-800" onClick={() => void batches.refetch()} type="button">Retry</button>
          </div>
        ) : active.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {active.map((batch) => <PaperNoteBatchCard batch={batch} key={batch.id} />)}
          </div>
        ) : !batches.isLoading ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">No paper-note batches are waiting for review.</p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Loading imports…</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-slate-900">Completed</h2>
        {completed.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {completed.map((batch) => <PaperNoteBatchCard batch={batch} key={batch.id} />)}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Completed paper imports will stay here with their source photos.</p>
        )}
      </section>
    </div>
  );
}
