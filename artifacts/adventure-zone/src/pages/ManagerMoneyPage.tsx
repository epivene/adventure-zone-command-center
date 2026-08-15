import { useEffect, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { EventIncomeForm } from "@/components/manager/event-income-form";
import { SettlementSummary } from "@/components/manager/settlement-summary";
import { ExpenseForm } from "@/components/manager/expense-form";
import { CashEntryForm } from "@/components/manager/cash-entry-form";

type Summary = {
  incomeTotalCents: number;
  expenseTotalCents: number;
  missingReceiptCount?: number;
  cashPosition: { cashOnHandCents: number };
  settlement: { ownerOwesManagerCents: number; managerOwesOwnerCents: number; netCents: number };
};
type Dashboard = { events: Array<{ id: string; bookingId?: string | null; name?: string; tripId?: string | null }> };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function ManagerMoneyPage() {
  const { managerApi } = useManagerAuth(); const [summary, setSummary] = useState<Summary | null>(null); const [events, setEvents] = useState<Dashboard["events"]>([]); const [error, setError] = useState("");
  useEffect(() => { Promise.all([managerApi<Summary>("/manager/money/summary"), managerApi<Dashboard>("/manager/dashboard")]).then(([nextSummary, dashboard]) => { setSummary(nextSummary); setEvents(dashboard.events ?? []); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load money")); }, [managerApi]);
  if (error) return <p role="alert">{error}</p>; if (!summary) return <p>Loading money…</p>;
  return <div className="grid gap-4"><header><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Money</p><h1 className="text-2xl font-bold">Leg money & settlement</h1></header><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">Income</p><p className="font-bold">{money(summary.incomeTotalCents)}</p></div><div className="rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">Expenses</p><p className="font-bold">{money(summary.expenseTotalCents)}</p></div><div className="rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">Cash on hand</p><p className="font-bold">{money(summary.cashPosition.cashOnHandCents)}</p></div><div className="rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">Receipts needing attention</p><p className="font-bold">{summary.missingReceiptCount ?? 0}</p></div></div><SettlementSummary settlement={summary.settlement}/><a className="rounded-xl border bg-white p-3 font-semibold" href="/manager/receipts">Receipt photos →</a><a className="rounded-xl border bg-white p-3 font-semibold" href="/manager/operations">Mileage & operations →</a><EventIncomeForm events={events}/><ExpenseForm/><CashEntryForm/></div>;
}
