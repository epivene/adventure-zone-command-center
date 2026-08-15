import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );

type LegStatus = {
  legId: string;
  legName: string;
  archivedAt: string | null;
  enabled: boolean;
};

type MoneySummary = {
  incomeTotalCents: number;
  expenseTotalCents: number;
  settlement: { netCents: number };
  expenses?: unknown[];
};

export default function ManagerFinanceAdminPage() {
  const [legs, setLegs] = useState<LegStatus[]>([]);
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [selected, setSelected] = useState<(MoneySummary & { leg: LegStatus }) | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet<{ legs: LegStatus[] }>("/manager-admin/legs/access"),
      apiGet<MoneySummary>("/manager-admin/money/summary"),
    ]).then(([legData, combined]) => {
      setLegs(legData.legs ?? []);
      setSummary(combined);
    });
  }, []);

  async function openLeg(leg: LegStatus) {
    const detail = await apiGet<MoneySummary>(
      `/manager-admin/legs/${leg.legId}/money/summary`,
    );
    setSelected({ leg, ...detail });
  }

  if (!summary) return <p>Loading manager finances…</p>;

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <header>
        <p className="text-sm font-bold uppercase tracking-wide text-orange-700">
          Leg managers
        </p>
        <h1 className="text-3xl font-bold">Finance overview</h1>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-slate-500">Combined income</p>
          <p className="text-xl font-bold">{money(summary.incomeTotalCents)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-slate-500">Combined expenses</p>
          <p className="text-xl font-bold">{money(summary.expenseTotalCents)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs text-slate-500">Net settlement</p>
          <p className="text-xl font-bold">{money(summary.settlement?.netCents ?? 0)}</p>
        </div>
      </section>

      <label className="flex gap-2">
        <input
          type="checkbox"
          aria-label="Show archived legs"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Show archived legs
      </label>

      <section className="grid gap-2">
        {legs
          .filter((leg) => showArchived || !leg.archivedAt)
          .map((leg) => (
            <button
              key={leg.legId}
              className="rounded-xl border bg-white p-4 text-left"
              onClick={() => void openLeg(leg)}
            >
              {leg.legName}
              {leg.archivedAt ? " — Archived" : ""}
            </button>
          ))}
      </section>

      {selected ? (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-bold">{selected.leg.legName}</h2>
          <p>Income: {money(selected.incomeTotalCents)}</p>
          <p>Expenses: {money(selected.expenseTotalCents)}</p>
          <p>Settlement: {money(selected.settlement?.netCents ?? 0)}</p>
        </section>
      ) : null}
    </div>
  );
}
