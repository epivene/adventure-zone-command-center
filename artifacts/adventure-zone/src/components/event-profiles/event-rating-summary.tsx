export function EventRatingSummary({ average, count }: { average: number | null; count: number }) {
  const numericAverage = average ?? 0;
  const filledStars = average == null || count === 0 ? 0 : Math.max(0, Math.min(5, Math.round(average)));
  const stars = `${"★".repeat(filledStars)}${"☆".repeat(5 - filledStars)}`;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Average event rating">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Average rating</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <span className="text-2xl font-bold text-amber-600" aria-hidden="true">{stars}</span>
        <span className="text-xl font-bold">{numericAverage.toFixed(1)} / 5</span>
        <span className="text-sm text-slate-600">{count} rated occurrence{count === 1 ? "" : "s"}</span>
      </div>
      {count === 0 ? <p className="mt-1 text-xs text-slate-500">No event ratings have been submitted yet.</p> : null}
    </section>
  );
}
