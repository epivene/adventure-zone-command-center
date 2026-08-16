function money(cents: number | null | undefined) {
  if (cents == null) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function difference(cents: number | null | undefined) {
  if (cents == null) return "Not counted";
  if (cents === 0) return "Balanced";
  return `${money(Math.abs(cents))} ${cents < 0 ? "short" : "over"}`;
}

export function EventWrapUpReviewQueue({ wrapUps }: { wrapUps: any[] }) {
  if (!wrapUps.length) return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">No submitted event wrap-ups are waiting for review.</p>;
  return <div className="grid gap-3">
    {wrapUps.map((item) => {
      const trueProfit = item.calculation?.trueProfit;
      const reasons = trueProfit?.incompleteReasons ?? [];
      return <article key={item.event.bookingId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">{item.event.name}</h3>
            <p className="text-sm text-slate-600">{item.event.legName}{item.event.startsAt ? ` · ${new Date(item.event.startsAt).toLocaleDateString()}` : ""}</p>
            <p className="mt-2 text-xl text-amber-600" aria-label={`${item.wrapUp?.ratingStars ?? 0} stars`}>{"★".repeat(item.wrapUp?.ratingStars ?? 0)}</p>
          </div>
          <a className="button-primary" href={`/manager-aftermath?wrapUp=${encodeURIComponent(item.event.bookingId)}`}>Review wrap-up</a>
        </div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p><span className="font-semibold">Cash:</span> {difference(item.calculation?.settlement?.differenceCents)}</p>
          <p><span className="font-semibold">Direct profit:</span> {money(item.calculation?.directProfit?.profitCents)}</p>
          <p><span className="font-semibold">Estimated true profit:</span> {trueProfit?.profitCents == null ? "unavailable" : money(trueProfit.profitCents)}</p>
          <p><span className="font-semibold">Submitted:</span> {item.wrapUp?.submittedAt ? new Date(item.wrapUp.submittedAt).toLocaleString() : "—"}</p>
        </div>
        {item.finance?.missingReceiptCount ? <p className="mt-2 text-sm font-semibold text-amber-700">{item.finance.missingReceiptCount} receipt{item.finance.missingReceiptCount === 1 ? "" : "s"} missing or incomplete</p> : null}
        {reasons.map((reason: string) => <p key={reason} className="mt-1 text-sm font-semibold text-amber-700">{reason}</p>)}
      </article>;
    })}
  </div>;
}
