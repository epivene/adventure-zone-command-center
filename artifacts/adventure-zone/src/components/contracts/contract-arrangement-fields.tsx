import type { ContractArrangement, ContractValues } from "@/features/contracts/contract-types";

function cents(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function ContractArrangementFields({ values, onChange }: { values: ContractValues; onChange(values: ContractValues): void }) {
  const commercial = values.commercialTerms;
  const updateArrangement = (arrangement: ContractArrangement) => onChange({
    ...values,
    arrangement,
    commercialTerms: {
      ...commercial,
      guaranteedFeeCents: arrangement === "pay_for_play" ? null : commercial.guaranteedFeeCents,
      eventPercentageBasisPoints: arrangement === "guaranteed_fee" ? null : commercial.eventPercentageBasisPoints,
      percentageBase: arrangement === "guaranteed_fee" ? null : commercial.percentageBase,
    },
  });
  const update = (patch: Partial<ContractValues["commercialTerms"]>) => onChange({ ...values, commercialTerms: { ...commercial, ...patch } });
  return (
    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">Commercial arrangement</h2>
      <label className="grid gap-1 text-sm font-semibold">Contract arrangement
        <select aria-label="Contract arrangement" value={values.arrangement} onChange={(event) => updateArrangement(event.target.value as ContractArrangement)}>
          <option value="guaranteed_fee">Guaranteed fee</option>
          <option value="pay_for_play">Pay for play</option>
          <option value="guarantee_plus_percentage">Guarantee plus percentage</option>
        </select>
      </label>
      {values.arrangement !== "pay_for_play" ? <label className="grid gap-1 text-sm font-semibold">Guaranteed fee
        <input aria-label="Guaranteed fee" min="0" step="0.01" type="number" value={(commercial.guaranteedFeeCents ?? 0) / 100} onChange={(event) => update({ guaranteedFeeCents: cents(event.target.value) })} />
      </label> : null}
      {values.arrangement !== "guaranteed_fee" ? <>
        <label className="grid gap-1 text-sm font-semibold">Event percentage
          <input aria-label="Event percentage" min="0" max="100" step="0.01" type="number" value={(commercial.eventPercentageBasisPoints ?? 0) / 100} onChange={(event) => update({ eventPercentageBasisPoints: Math.round(Number(event.target.value) * 100) })} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Percentage base
          <input aria-label="Percentage base" value={commercial.percentageBase ?? ""} onChange={(event) => update({ percentageBase: event.target.value })} />
        </label>
      </> : null}
    </section>
  );
}
