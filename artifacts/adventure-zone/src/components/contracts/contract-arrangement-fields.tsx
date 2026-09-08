import { commercialTermsFor } from "@/features/contracts/contract-form-values";
import type { ContractArrangement, ContractCommercialTerms, ContractValues } from "@/features/contracts/contract-types";

const money = (value: number) => value / 100;
const cents = (value: string) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;
const basisPoints = (value: string) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange(value: string): void; type?: string }) {
  return <label className="grid gap-1 text-sm font-semibold">{label}<input aria-label={label} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function ContractArrangementFields({ values, onChange }: { values: ContractValues; onChange(values: ContractValues): void }) {
  const update = (commercialTerms: ContractCommercialTerms) => onChange({ ...values, arrangement: commercialTerms.arrangement, commercialTerms });
  const terms = values.commercialTerms;
  return <section className="grid gap-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-bold">Commercial arrangement</h2>
    <label className="grid gap-1 text-sm font-semibold">Contract arrangement<select aria-label="Contract arrangement" value={values.arrangement} onChange={(event) => update(commercialTermsFor(event.target.value as ContractArrangement))}><option value="guaranteed_fee">Guaranteed fee</option><option value="pay_for_play">Pay for play</option><option value="guarantee_plus_percentage">Guarantee plus percentage</option></select></label>
    {terms.arrangement === "guaranteed_fee" ? <>
      <Field label="Total guaranteed fee" type="number" value={money(terms.totalFeeCents)} onChange={(v) => update({ ...terms, totalFeeCents: cents(v) })} /><Field label="Deposit" type="number" value={money(terms.depositCents)} onChange={(v) => update({ ...terms, depositCents: cents(v) })} /><Field label="Deposit due date" type="date" value={terms.depositDueDate} onChange={(v) => update({ ...terms, depositDueDate: v })} /><Field label="Balance" type="number" value={money(terms.balanceCents)} onChange={(v) => update({ ...terms, balanceCents: cents(v) })} /><Field label="Payment timing" value={terms.paymentTiming} onChange={(v) => update({ ...terms, paymentTiming: v })} /><Field label="Discount wording" value={terms.discountWording} onChange={(v) => update({ ...terms, discountWording: v })} />
    </> : null}
    {terms.arrangement === "pay_for_play" ? <>
      <Field label="Event percentage" type="number" value={terms.eventShareBasisPoints / 100} onChange={(v) => update({ ...terms, eventShareBasisPoints: basisPoints(v) })} /><Field label="Settlement timing" value={terms.settlementTiming} onChange={(v) => update({ ...terms, settlementTiming: v })} /><Field label="Ticket authority" value={terms.ticketAuthority} onChange={(v) => update({ ...terms, ticketAuthority: v })} /><Field label="Collection arrangement" value={terms.collectionArrangement} onChange={(v) => update({ ...terms, collectionArrangement: v })} /><Field label="Upfront charge" type="number" value={money(terms.upfrontChargeCents)} onChange={(v) => update({ ...terms, upfrontChargeCents: cents(v) })} />
    </> : null}
    {terms.arrangement === "guarantee_plus_percentage" ? <>
      <Field label="Guaranteed fee" type="number" value={money(terms.guaranteeCents)} onChange={(v) => update({ ...terms, guaranteeCents: cents(v) })} /><Field label="Deposit" type="number" value={money(terms.depositCents)} onChange={(v) => update({ ...terms, depositCents: cents(v) })} /><Field label="Deposit due date" type="date" value={terms.depositDueDate} onChange={(v) => update({ ...terms, depositDueDate: v })} /><Field label="Balance" type="number" value={money(terms.balanceCents)} onChange={(v) => update({ ...terms, balanceCents: cents(v) })} /><Field label="Payment timing" value={terms.paymentTiming} onChange={(v) => update({ ...terms, paymentTiming: v })} /><Field label="Event percentage" type="number" value={terms.eventShareBasisPoints / 100} onChange={(v) => update({ ...terms, eventShareBasisPoints: basisPoints(v) })} /><Field label="Percentage base" value={terms.percentageBase} onChange={(v) => update({ ...terms, percentageBase: v })} /><Field label="Ticket authority" value={terms.ticketAuthority} onChange={(v) => update({ ...terms, ticketAuthority: v })} /><Field label="Collection arrangement" value={terms.collectionArrangement} onChange={(v) => update({ ...terms, collectionArrangement: v })} />
    </> : null}
  </section>;
}
