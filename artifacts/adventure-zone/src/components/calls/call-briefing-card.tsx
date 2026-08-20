import type { CallBriefing } from "@/features/calls/call-types";

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function CallBriefingCard({ briefing }: { briefing: CallBriefing }) {
  return (
    <section
      aria-labelledby="call-briefing-title"
      className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm"
      data-testid="call-briefing"
    >
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-800">
        Why you're calling
      </p>
      <h2 className="mt-1 text-lg font-bold text-slate-950" id="call-briefing-title">
        {briefing.headline}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        {briefing.status ? <span className="rounded-full bg-white px-2.5 py-1">{briefing.status.replaceAll("_", " ")}</span> : null}
        {briefing.eventDate ? <span className="rounded-full bg-white px-2.5 py-1">{formatDate(briefing.eventDate)}</span> : null}
        {briefing.location ? <span className="rounded-full bg-white px-2.5 py-1">{briefing.location}</span> : null}
        {briefing.routeLeg ? <span className="rounded-full bg-white px-2.5 py-1">{briefing.routeLeg}</span> : null}
      </div>
      {briefing.keyFacts.length ? (
        <ul className="mt-3 grid gap-1 text-sm text-slate-700">
          {briefing.keyFacts.map((fact) => <li key={fact}>• {fact}</li>)}
        </ul>
      ) : null}
      {briefing.historySummary ? (
        <p className="mt-3 rounded-lg bg-white/80 p-3 text-sm text-slate-700">
          {briefing.historySummary}
        </p>
      ) : null}
    </section>
  );
}
