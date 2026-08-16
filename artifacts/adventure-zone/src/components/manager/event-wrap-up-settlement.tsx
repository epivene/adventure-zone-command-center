function money(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function EventWrapUpSettlement({ expectedCashCents, nonCashCents, actualCash, differenceNote, disabled, onActualCashChange, onDifferenceNoteChange }: {
  expectedCashCents: number;
  nonCashCents: number;
  actualCash: string;
  differenceNote: string;
  disabled?: boolean;
  onActualCashChange: (value: string) => void;
  onDifferenceNoteChange: (value: string) => void;
}) {
  const actualCents = actualCash.trim() === "" ? null : Math.round(Number(actualCash) * 100);
  const difference = actualCents == null || !Number.isFinite(actualCents) ? null : actualCents - expectedCashCents;
  const differenceLabel = difference == null ? "Count cash to see over / short" : difference === 0 ? "Cash matches" : difference < 0 ? `${money(Math.abs(difference))} short` : `${money(difference)} over`;
  return <section className="grid gap-3 rounded-xl border bg-white p-4">
    <div><h2 className="text-lg font-bold">Money check</h2><p className="text-sm text-slate-600">Physical cash is reconciled separately from card/Square and other non-cash income.</p></div>
    <div className="grid gap-2 sm:grid-cols-3"><div><p className="text-xs font-bold uppercase text-slate-500">Expected cash</p><p className="text-xl font-bold">{money(expectedCashCents)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Non-cash revenue</p><p className="text-xl font-bold">{money(nonCashCents)}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Over / short</p><p className="text-xl font-bold">{differenceLabel}</p></div></div>
    <label className="grid gap-1 text-sm font-semibold">Actual cash on hand<input aria-label="Actual cash on hand" inputMode="decimal" disabled={disabled} value={actualCash} onChange={(event) => onActualCashChange(event.currentTarget.value)} placeholder="0.00" /></label>
    {difference !== null && difference !== 0 ? <label className="grid gap-1 text-sm font-semibold">Cash difference note<textarea aria-label="Cash difference note" rows={2} disabled={disabled} value={differenceNote} onChange={(event) => onDifferenceNoteChange(event.currentTarget.value)} placeholder="What explains the difference?" /></label> : null}
  </section>;
}
