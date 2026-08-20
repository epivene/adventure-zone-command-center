import type { PaperNoteReviewDraft } from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteEventDateReview({
  event,
  onChange,
}: {
  event: PaperNoteReviewDraft["event"];
  onChange(patch: Partial<PaperNoteReviewDraft["event"]>): void;
}) {
  const hasStructuredDate = Boolean(event.startsOn || event.endsOn);

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Event date as written
        <input
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={event.eventDateText}
          onChange={(change) => onChange({ eventDateText: change.target.value })}
        />
      </label>

      {hasStructuredDate ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Event start date
              <input
                aria-label="Event start date"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                type="date"
                value={event.startsOn ?? ""}
                onChange={(change) => onChange({ startsOn: change.target.value || null })}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Event end date
              <input
                aria-label="Event end date"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                type="date"
                value={event.endsOn ?? ""}
                onChange={(change) => onChange({ endsOn: change.target.value || null })}
              />
            </label>
          </div>

          {!event.pageYearConfirmed ? (
            <label className="flex min-h-11 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
              <input
                aria-label="Confirm event year from paper context"
                className="mt-1"
                type="checkbox"
                checked={event.pageYearConfirmed}
                onChange={(change) => onChange({ pageYearConfirmed: change.target.checked })}
              />
              <span>
                Confirm this event year
                <span className="mt-1 block font-normal text-amber-900">
                  The handwriting reader inferred the year from the page context. Check the original paper before approving it.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-xs font-semibold text-emerald-800">Event year confirmed.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
