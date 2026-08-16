export function EventRatingSummary({ average, count }: { average: number | null; count: number }) {
  const hasRating = average != null && count > 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Average event rating">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Average rating</p>
      {hasRating ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <span className="text-2xl font-bold text-amber-600" aria-hidden="true">★★★★★</span>
          <span className="text-xl font-bold">{average.toFixed(1)} / 5</span>
          <span className="text-sm text-slate-600">{count} rated occurrence{count === 1 ? "" : "s"}</span>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No rated occurrences yet</p>
      )}
    </section>
  );
}
