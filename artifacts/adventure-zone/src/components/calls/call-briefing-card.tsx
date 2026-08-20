import type { CallBriefing } from "@/features/calls/call-types";

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function CallBriefingCard({ briefing }: { briefing: CallBriefing }) {
  const hasSecondary = briefing.keyFacts.length > 0 || Boolean(briefing.historySummary);
  return (
    <section
      aria-labelledby="call-briefing-title"
      className="rounded-xl border border-orange-200 bg-orange-50 p-3 shadow-sm"
      data-testid="call-briefing"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-800">Why you're calling</p>
          <h2 className="mt-0.5 text-base font-bold text-slate-950" id="call-briefing-title">{briefing.headline}</h2>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 text-[11px] font-semibold text-slate-700">
          {briefing.status ? <span className="rounded-full bg-white px-2 py-1">{briefing.status.replaceAll("_", " ")}</span> : null}
          {briefing.routeLeg ? <span className="rounded-full bg-white px-2 py-1">{briefing.routeLeg}</span> : null}
          {briefing.eventDate ? <span className="rounded-full bg-white px-2 py-1">{formatDate(briefing.eventDate)}</span> : null}
          {briefing.location ? <span className="rounded-full bg-white px-2 py-1">{briefing.location}</span> : null}
        </div>
      </div>
      {hasSecondary ? (
        <details className="mt-2 border-t border-orange-200/70 pt-2">
          <summary className="cursor-pointer text-xs font-bold text-slate-700">Quick facts & history</summary>
          {briefing.keyFacts.length ? (
            <ul className="mt-2 grid gap-1 text-sm text-slate-700">
              {briefing.keyFacts.map((fact) => <li key={fact}>• {fact}</li>)}
            </ul>
          ) : null}
          {briefing.historySummary ? <p className="mt-2 rounded-lg bg-white p-3 text-sm text-slate-700">{briefing.historySummary}</p> : null}
        </details>
      ) : null}
    </section>
  );
}
