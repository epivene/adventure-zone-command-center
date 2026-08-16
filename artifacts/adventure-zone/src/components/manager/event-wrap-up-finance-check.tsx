function money(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function EventWrapUpFinanceCheck({ payload }: { payload: any }) {
  const missing = payload.finance.missingReceiptCount as number;
  return <div className="grid gap-4 md:grid-cols-2">
    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <div><h2 className="text-lg font-bold">Receipts & expenses</h2><p className="text-sm text-slate-600">This uses the expenses already recorded for the event.</p></div>
      <p className={missing ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{missing ? `${missing} receipt${missing === 1 ? "" : "s"} missing or incomplete` : "Receipts look complete"}</p>
      <p className="text-sm">Recorded direct expenses: {money(payload.calculation.directProfit.directExpenseCents)}</p>
      <a className="button-secondary text-center" href="/manager/receipts">Review receipts →</a>
    </section>
    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <div><h2 className="text-lg font-bold">Travel share</h2><p className="text-sm text-slate-600">Trip mileage is automatically allocated by route position.</p></div>
      <div className="grid grid-cols-2 gap-2 text-sm"><div><span className="text-slate-500">Allocated miles</span><p className="font-bold">{payload.travel.appliedMiles.toFixed(1)} mi</p></div><div><span className="text-slate-500">Trip share</span><p className="font-bold">{payload.travel.automaticSharePercent == null ? "—" : `${payload.travel.automaticSharePercent.toFixed(1)}%`}</p></div><div><span className="text-slate-500">MPG</span><p className="font-bold">{payload.travel.mpg ?? "—"}</p></div><div><span className="text-slate-500">Fuel price</span><p className="font-bold">{payload.travel.fuelPricePerGallon == null ? "—" : `$${payload.travel.fuelPricePerGallon.toFixed(2)}/gal`}</p></div></div>
      <p className="text-sm font-semibold">Allocated travel/fuel: {money(payload.calculation.travel.allocatedFuelCostCents)}</p>
      {payload.calculation.travel.source === "admin_override" ? <p className="text-xs font-semibold text-blue-700">Admin-adjusted allocation</p> : null}
    </section>
  </div>;
}
