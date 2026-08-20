import type { PaperNoteReviewDraft } from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteEventEditor({
  event,
  onChange,
}: {
  event: PaperNoteReviewDraft["event"];
  onChange<K extends keyof PaperNoteReviewDraft["event"]>(
    key: K,
    value: PaperNoteReviewDraft["event"][K],
  ): void;
}) {
  const hasStructuredDate = Boolean(event.startsOn || event.endsOn);
  return (
    <section className="mt-5 grid gap-3">
      <h3 className="font-bold text-slate-900">Event</h3>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Event / profile name
        <input aria-label="Event / profile name" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={event.name} onChange={(input) => onChange("name", input.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          City
          <input aria-label="City" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={event.city} onChange={(input) => onChange("city", input.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          State
          <input aria-label="State" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal uppercase" maxLength={2} value={event.region} onChange={(input) => onChange("region", input.target.value.toUpperCase())} />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Venue
        <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={event.venue} onChange={(input) => onChange("venue", input.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Event date as written
        <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={event.eventDateText} onChange={(input) => onChange("eventDateText", input.target.value)} />
      </label>
      {hasStructuredDate ? (
        <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Event start date
            <input aria-label="Event start date" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" type="date" value={event.startsOn ?? ""} onChange={(input) => onChange("startsOn", input.target.value || null)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Event end date
            <input aria-label="Event end date" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" type="date" value={event.endsOn ?? ""} onChange={(input) => onChange("endsOn", input.target.value || null)} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-amber-950 sm:col-span-2">
            <input
              aria-label="Confirm event year from paper/context"
              type="checkbox"
              checked={event.pageYearConfirmed}
              onChange={(input) => onChange("pageYearConfirmed", input.target.checked)}
            />
            Confirm event year from paper/context
          </label>
          {!event.pageYearConfirmed ? (
            <p className="text-xs text-amber-900 sm:col-span-2">The date was parsed with a year that still needs your confirmation before this entry can be approved.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
