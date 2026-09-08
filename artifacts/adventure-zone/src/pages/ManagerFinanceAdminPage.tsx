import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import {
  AdminExpenseRecordCard,
  type AdminExpenseRecord,
  type FinanceEventOption,
} from "@/components/manager-finance/admin-expense-record";
import { LegEventRecordGroups } from "@/components/records/leg-event-record-groups";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );

const categories = [
  ["", "All categories"],
  ["fuel", "Fuel"], ["food", "Food"], ["rv_park", "RV park"],
  ["vehicle_maintenance", "Vehicle maintenance"], ["trailer_maintenance", "Trailer maintenance"],
  ["supplies", "Supplies"], ["employee_related", "Employee related"], ["other", "Other"],
] as const;

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
  const [records, setRecords] = useState<AdminExpenseRecord[]>([]);
  const [events, setEvents] = useState<FinanceEventOption[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [recordsError, setRecordsError] = useState("");
  const [legFilter, setLegFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [receiptFilter, setReceiptFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function loadSummary() {
    const [legData, combined] = await Promise.all([
      apiGet<{ legs: LegStatus[] }>("/manager-admin/legs/access"),
      apiGet<MoneySummary>("/manager-admin/money/summary"),
    ]);
    setLegs(legData.legs ?? []);
    setSummary(combined);
  }

  async function loadRecords() {
    setLoadingRecords(true);
    setRecordsError("");
    try {
      const [expenseData, routeData] = await Promise.all([
        apiGet<{ records: AdminExpenseRecord[] }>("/manager-admin/finance/expenses"),
        apiGet<any>("/routes").catch(() => ({ events: [] })),
      ]);
      setRecords(expenseData.records ?? []);
      setEvents((routeData.events ?? []).map((event: any) => ({
        id: String(event.id),
        name: String(event.name ?? "Unnamed event"),
        travelLegId: event.travelLegId ?? null,
        startsAt: event.startsAt ?? null,
      })));
    } catch (cause) {
      setRecordsError(cause instanceof Error ? cause.message : "Could not load submitted expenses.");
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    void loadSummary();
    void loadRecords();
  }, []);

  async function openLeg(leg: LegStatus) {
    const detail = await apiGet<MoneySummary>(
      `/manager-admin/legs/${leg.legId}/money/summary`,
    );
    setSelected({ leg, ...detail });
    setLegFilter(leg.legId);
  }

  const filteredRecords = useMemo(() => records.filter((record) => {
    if (legFilter && record.legId !== legFilter) return false;
    if (categoryFilter && record.category !== categoryFilter) return false;
    if (paymentFilter && record.paymentSource !== paymentFilter) return false;
    if (scopeFilter === "event" && !record.bookingId) return false;
    if (scopeFilter === "general" && record.bookingId) return false;
    if (receiptFilter === "attached" && record.receipt?.imageStatus !== "image_uploaded") return false;
    if (receiptFilter === "missing" && record.receipt) return false;
    if (receiptFilter === "incomplete" && (!record.receipt || record.receipt.imageStatus === "image_uploaded")) return false;
    if (dateFrom && record.occurredAt.slice(0, 10) < dateFrom) return false;
    if (dateTo && record.occurredAt.slice(0, 10) > dateTo) return false;
    return true;
  }), [records, legFilter, categoryFilter, paymentFilter, scopeFilter, receiptFilter, dateFrom, dateTo]);

  function replaceRecord(next: AdminExpenseRecord) {
    setRecords((current) => current.map((record) => record.id === next.id ? next : record));
    void loadSummary();
  }

  function clearFilters() {
    setLegFilter("");
    setCategoryFilter("");
    setPaymentFilter("");
    setScopeFilter("");
    setReceiptFilter("");
    setDateFrom("");
    setDateTo("");
    setSelected(null);
  }

  if (!summary) return <p>Loading manager finances…</p>;

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <header>
        <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Leg managers</p>
        <h1 className="text-3xl font-bold">Finance overview</h1>
        <p className="mt-1 text-sm text-slate-600">Review submitted expenses, receipt photos, event assignments, and corrections alongside the totals.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Combined income</p><p className="text-xl font-bold">{money(summary.incomeTotalCents)}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Combined expenses</p><p className="text-xl font-bold">{money(summary.expenseTotalCents)}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Net settlement</p><p className="text-xl font-bold">{money(summary.settlement?.netCents ?? 0)}</p></div>
      </section>

      <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer font-bold">Leg totals</summary>
        <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" aria-label="Show archived legs" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived legs</label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {legs.filter((leg) => showArchived || !leg.archivedAt).map((leg) => (
            <button key={leg.legId} className={legFilter === leg.legId ? "rounded-xl border border-orange-300 bg-orange-50 p-4 text-left" : "rounded-xl border bg-white p-4 text-left"} onClick={() => void openLeg(leg)}>
              <b>{leg.legName}</b>{leg.archivedAt ? " — Archived" : ""}
            </button>
          ))}
        </div>
        {selected ? <div className="mt-3 rounded-xl border bg-slate-50 p-4"><h2 className="font-bold">{selected.leg.legName}</h2><p>Income: {money(selected.incomeTotalCents)}</p><p>Expenses: {money(selected.expenseTotalCents)}</p><p>Settlement: {money(selected.settlement?.netCents ?? 0)}</p></div> : null}
      </details>

      <section className="grid gap-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-bold">Submitted expenses & receipts</h2><p className="text-sm text-slate-600">Every manager-submitted expense stays visible here, including General / Unassigned items.</p></div>
          <button className="button-secondary" type="button" onClick={() => void loadRecords()}>Refresh</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold">Leg<select value={legFilter} onChange={(e) => setLegFilter(e.target.value)}><option value="">All legs</option>{legs.filter((leg) => showArchived || !leg.archivedAt).map((leg) => <option value={leg.legId} key={leg.legId}>{leg.legName}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">Category<select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>{categories.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">Scope<select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}><option value="">All</option><option value="event">Event-linked</option><option value="general">General / Unassigned</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">Receipt<select value={receiptFilter} onChange={(e) => setReceiptFilter(e.target.value)}><option value="">All</option><option value="attached">Photo attached</option><option value="missing">No receipt</option><option value="incomplete">Upload incomplete</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">Payment<select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}><option value="">All payment sources</option><option value="adventure_zone_cash">Adventure Zone cash</option><option value="adventure_zone_debit">Company debit</option><option value="personal">Personal money/card</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          <div className="flex items-end"><button className="button-secondary" type="button" onClick={clearFilters}>Clear filters</button></div>
        </div>
        <p className="text-sm font-semibold text-slate-600">{filteredRecords.length} matching expense{filteredRecords.length === 1 ? "" : "s"}</p>
      </section>

      {recordsError ? <section className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p role="alert" className="text-sm font-semibold text-rose-700">{recordsError}</p><button className="button-secondary mt-2" type="button" onClick={() => void loadRecords()}>Retry expenses</button></section> : loadingRecords ? <p className="text-sm text-slate-500">Loading submitted expenses…</p> : filteredRecords.length ? <LegEventRecordGroups records={filteredRecords} noun="receipt">{(record) => <AdminExpenseRecordCard key={record.id} record={record} events={events} onUpdated={replaceRecord} />}</LegEventRecordGroups> : <p className="rounded-xl border border-dashed bg-white p-6 text-sm text-slate-500">No expenses match these filters.</p>}
    </div>
  );
}
