function money(cents:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);}
export function SettlementSummary({settlement}:{settlement:{ownerOwesManagerCents:number;managerOwesOwnerCents:number;netCents:number}}){
  const text=settlement.netCents>0?`Adventure Zone owes you ${money(settlement.netCents)}`:settlement.netCents<0?`You owe Adventure Zone ${money(Math.abs(settlement.netCents))}`:"Settled";
  return <section className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Settlement</p><p className="mt-1 text-lg font-bold">{text}</p><p className="mt-1 text-sm text-slate-600">Calculated from ledger entries — not an editable balance.</p></section>;
}
