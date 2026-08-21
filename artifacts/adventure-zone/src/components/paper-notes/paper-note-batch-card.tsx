import { Trash2 } from "lucide-react";
import { Link } from "wouter";
import type { PaperNoteBatchListItem } from "@/features/paper-notes/paper-note-types";

function statusLabel(status: PaperNoteBatchListItem["status"]) {
  if (status === "draft") return "Uploading";
  if (status === "queued" || status === "extracting") return "Reading paper notes";
  if (status === "review") return "Ready to review";
  if (status === "importing") return "Importing";
  if (status === "imported") return "Imported";
  if (status === "failed") return "Needs attention";
  return "Archived";
}

function canDeleteBatch(status: PaperNoteBatchListItem["status"]) {
  return status === "draft" || status === "review" || status === "failed";
}

export function PaperNoteBatchCard({
  batch,
  onDelete,
  deleting = false,
}: {
  batch: PaperNoteBatchListItem;
  onDelete?(batchId: string): void | Promise<void>;
  deleting?: boolean;
}) {
  const deletable = Boolean(onDelete) && canDeleteBatch(batch.status);

  function confirmDelete() {
    if (!onDelete || deleting) return;
    const confirmed = window.confirm(
      "Delete this paper-note batch and start over? This removes this batch's uploaded photos, extracted entries, approvals, skips, and review work. It does not delete anything from the CRM.",
    );
    if (confirmed) void onDelete(batch.id);
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-orange-300 hover:shadow">
      <Link href={`/settings/paper-notes/${batch.id}`} className="block p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">
              {batch.name || `Paper notes · ${new Date(batch.createdAt).toLocaleDateString()}`}
            </h3>
            <p className="mt-1 text-sm font-medium text-slate-600">{statusLabel(batch.status)}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
            {batch.pageCount} {batch.pageCount === 1 ? "page" : "pages"}
          </span>
        </div>
        {batch.extractedEntryCount > 0 ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>{batch.extractedEntryCount} entries</span>
            <span>{batch.needsReviewCount} need review</span>
            <span>{batch.approvedCount} approved</span>
            <span>{batch.skippedCount} skipped</span>
          </div>
        ) : null}
        {batch.failedPageCount ? (
          <p className="mt-2 text-sm font-semibold text-rose-700">
            {batch.failedPageCount} {batch.failedPageCount === 1 ? "page needs" : "pages need"} attention
          </p>
        ) : null}
      </Link>
      {deletable ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <button
            aria-label="Delete batch"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50"
            disabled={deleting}
            onClick={confirmDelete}
            type="button"
          >
            <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete batch"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
