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

export function PaperNoteBatchCard({ batch }: { batch: PaperNoteBatchListItem }) {
  return (
    <Link
      href={`/settings/paper-notes/${batch.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:shadow"
    >
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
  );
}
