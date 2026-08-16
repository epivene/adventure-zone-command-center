function money(cents: number | null) {
  if (cents == null) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function EventWrapUpProfitability({ calculation }: { calculation: any }) {
  const direct = calculation.directProfit;
  const truth = calculation.trueProfit;
  return <section className="grid gap-3 rounded-xl border bg-white p-4">
    <div><h2 className="text-lg font-bold">Profitability</h2><p className="text-sm text-slate-600">Tap each number to see exactly where it came from.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <details className="rounded-lg border border-slate-200 p-3" open>
        <summary className="cursor-pointer"><span className="font-bold">Direct profit</span><span className="ml-2 text-xl font-bold">{money(direct.profitCents)}</span></summary>
        <div className="mt-3 grid gap-1 text-sm"><p>Revenue: {money(direct.revenueCents)}</p><p>Direct expenses: −{money(direct.directExpenseCents)}</p><p>Travel/fuel: −{money(direct.travelCostCents)}</p><p>Adjustments: {money(direct.adjustmentsCents)}</p></div>
      </details>
      <details className="rounded-lg border border-slate-200 p-3" open>
        <summary className="cursor-pointer"><span className="font-bold">Estimated true profit</span><span className="ml-2 text-xl font-bold">{money(truth.profitCents)}</span></summary>
        <div className="mt-3 grid gap-1 text-sm"><p>Direct profit: {money(truth.directProfitCents)}</p><p>Crew wages: {truth.crewWagesCents == null ? "Incomplete" : `−${money(truth.crewWagesCents)}`}</p><p>Overhead: {truth.overheadCents == null ? "Incomplete" : `−${money(truth.overheadCents)}`}</p><p>Adjustments: {money(truth.adjustmentsCents)}</p>{truth.incompleteReasons.map((reason: string) => <p key={reason} className="font-semibold text-amber-700">{reason}</p>)}</div>
      </details>
    </div>
  </section>;
}
