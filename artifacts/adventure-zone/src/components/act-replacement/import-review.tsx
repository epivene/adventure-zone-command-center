import { useState, type FormEvent } from "react";
import type {
  ReviewDisplayValue,
  ReviewPage,
} from "@/features/act-replacement/act-replacement-client";

const safeDisplayFields = new Set([
  "name",
  "displayname",
  "title",
  "subject",
  "firstname",
  "lastname",
  "fullname",
  "company",
  "companyname",
  "jobtitle",
  "email",
  "phone",
  "website",
  "address",
  "address1",
  "address2",
  "city",
  "state",
  "region",
  "postalcode",
  "zipcode",
  "country",
  "opportunityname",
  "stage",
  "status",
  "estimatedclosedate",
  "description",
  "type",
  "starttime",
  "endtime",
  "occurredat",
  "regarding",
]);

function readable(value: string) {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function displayValue(value: ReviewDisplayValue) {
  if (value === null) return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function ImportReview({
  safeOperationCount,
  reviewRequiredCount,
  review,
  loading = false,
  canImport = true,
  canResolveAmbiguous = false,
  importLabel = "Import safe records",
  onSearch,
  onPageChange,
  onImportAsNew,
  onImport,
  resolvingSourceRecordId = null,
}: {
  safeOperationCount: number;
  reviewRequiredCount: number;
  review: ReviewPage | null;
  loading?: boolean;
  canImport?: boolean;
  canResolveAmbiguous?: boolean;
  importLabel?: string;
  onSearch: (search: string) => void;
  onPageChange: (page: number) => void;
  onImportAsNew: (row: ReviewPage["rows"][number]) => void;
  onImport: () => void;
  resolvingSourceRecordId?: string | null;
}) {
  const [search, setSearch] = useState("");
  const issueCounts = new Map<string, number>();
  for (const row of review?.rows ?? []) {
    for (const issue of row.issueCodes) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }
  const totalPages = review
    ? Math.max(1, Math.ceil(review.total / review.pageSize))
    : 1;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onSearch(search.trim());
  };

  return (
    <section
      className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-labelledby="act-import-review-heading"
    >
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Review
        </p>
        <h2
          id="act-import-review-heading"
          className="mt-1 text-xl font-semibold text-slate-900"
        >
          Check what can be imported safely
        </h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">
            {safeOperationCount.toLocaleString()} safe operations ready
          </p>
          <p className="mt-1 text-sm text-green-800">
            Only additions and empty-field updates are included.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">
            {reviewRequiredCount.toLocaleString()} records need your review
          </p>
          <p className="mt-1 text-sm text-amber-800">
            These records are kept out of automatic import.
          </p>
        </div>
      </div>

      <form
        role="search"
        onSubmit={submitSearch}
        className="flex flex-wrap gap-2"
      >
        <label className="min-w-56 flex-1 text-sm font-medium text-slate-700">
          Search review records
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="self-end rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Search
        </button>
      </form>

      {issueCounts.size > 0 && (
        <div aria-label="Issue groups on this page">
          <h3 className="text-sm font-semibold text-slate-800">
            Issue groups on this page
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...issueCounts.entries()].map(([issue, count]) => (
              <li
                key={issue}
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900"
              >
                {readable(issue)} ({count})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p className="text-sm text-slate-600">Loading review records…</p>
        ) : review && review.rows.length > 0 ? (
          <ul className="space-y-3">
            {review.rows.map((row) => {
              const display = Object.entries(row.display).filter(([field]) =>
                safeDisplayFields.has(field.toLowerCase()),
              );
              return (
                <li
                  key={`${row.sourceRecordId}:${row.sourceVersionId}`}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {readable(row.streamType ?? "Act record")}
                    </p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      {readable(row.state)}
                    </span>
                  </div>
                  {display.length > 0 ? (
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      {display.map(([field, value]) => (
                        <div key={field}>
                          <dt className="text-xs font-medium text-slate-500">
                            {readable(field)}
                          </dt>
                          <dd className="text-slate-800">
                            {displayValue(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">
                      No display details are available for this archived record.
                    </p>
                  )}
                  {canResolveAmbiguous &&
                    row.issueCodes.includes("ambiguous_match") && (
                    <button
                      type="button"
                      disabled={loading || resolvingSourceRecordId !== null}
                      onClick={() => onImportAsNew(row)}
                      className="mt-4 rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 disabled:opacity-50"
                    >
                      {resolvingSourceRecordId === row.sourceRecordId
                        ? "Saving decision…"
                        : "Import as new record"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No review records match this view.
          </p>
        )}
      </div>

      {review && review.total > 0 && (
        <nav
          aria-label="Review pagination"
          className="flex items-center justify-between gap-3"
        >
          <button
            type="button"
            aria-label="Previous review page"
            disabled={review.page <= 1 || loading}
            onClick={() => onPageChange(review.page - 1)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-sm text-slate-600">
            Page {review.page} of {totalPages}
          </p>
          <button
            type="button"
            aria-label="Next review page"
            disabled={review.page >= totalPages || loading}
            onClick={() => onPageChange(review.page + 1)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}

      {safeOperationCount > 0 && (
        <button
          type="button"
          disabled={!canImport}
          onClick={onImport}
          className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {importLabel}
        </button>
      )}
    </section>
  );
}
