import type { ContractValues } from "@/features/contracts/contract-types";

export function ContractOperationalFields({ values, onChange }: { values: ContractValues; onChange(values: ContractValues): void }) {
  const terms = values.operationalTerms;
  const update = (patch: Partial<typeof terms>) => onChange({ ...values, operationalTerms: { ...terms, ...patch } });
  return (
    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">Operating responsibilities</h2>
      {([
        ["powerConfirmed", "Power requirements confirmed"],
        ["siteAccessConfirmed", "Site access confirmed"],
        ["staffingConfirmed", "Staffing responsibilities confirmed"],
      ] as const).map(([key, label]) => (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold" key={key}>
          <input checked={terms[key]} onChange={(event) => update({ [key]: event.target.checked })} type="checkbox" />
          {label}
        </label>
      ))}
    </section>
  );
}
