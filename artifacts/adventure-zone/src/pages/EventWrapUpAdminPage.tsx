import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/auth-token";
import {
  AdminExpenseRecordCard,
  type AdminExpenseRecord,
  type FinanceEventOption,
} from "@/components/manager-finance/admin-expense-record";

function money(cents: number | null | undefined) {
  if (cents == null) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function cashDifference(cents: number | null | undefined) {
  if (cents == null) return "Not counted";
  if (cents === 0) return "Balanced";
  return `${money(Math.abs(cents))} ${cents < 0 ? "short" : "over"}`;
}
function centsFromDollars(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export default function EventWrapUpAdminPage({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<any>(null);
  const [expenseRecords, setExpenseRecords] = useState<AdminExpenseRecord[]>([]);
  const [financeEvents, setFinanceEvents] = useState<FinanceEventOption[]>([]);
  const [financeError, setFinanceError] = useState("");
  const [financeLoading, setFinanceLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stars, setStars] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [cashNote, setCashNote] = useState("");
  const [travelMiles, setTravelMiles] = useState("");
  const [travelCost, setTravelCost] = useState("");
  const [travelReason, setTravelReason] = useState("");
  const [overheadAmount, setOverheadAmount] = useState("");
  const [overheadLabel, setOverheadLabel] = useState("Event overhead");
  const [overheadReason, setOverheadReason] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentLabel, setAdjustmentLabel] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentScope, setAdjustmentScope] = useState<"direct" | "true_profit">("direct");

  async function load() {
    const next = await apiGet<any>(`/event-wrap-up-admin/${bookingId}`);
    setData(next);
    setStars(next.wrapUp?.ratingStars ?? null);
    setNotes(next.wrapUp?.ratingNotes ?? "");
    setActualCash(next.wrapUp?.actualCashOnHandCents == null ? "" : (next.wrapUp.actualCashOnHandCents / 100).toFixed(2));
    setCashNote(next.wrapUp?.cashDifferenceNote ?? "");
    setTravelMiles(next.travel?.appliedMiles == null ? "" : String(next.travel.appliedMiles));
    setOverheadAmount(next.overhead?.amountCents == null ? "" : (next.overhead.amountCents / 100).toFixed(2));
    setOverheadLabel(next.overhead?.label ?? "Event overhead");
  }

  async function loadFinanceEvidence() {
    setFinanceLoading(true);
    setFinanceError("");
    try {
      const [expenseData, routeData] = await Promise.all([
        apiGet<{ records: AdminExpenseRecord[] }>(`/manager-admin/finance/expenses?bookingId=${encodeURIComponent(bookingId)}`),
        apiGet<any>("/routes").catch(() => ({ events: [] })),
      ]);
      setExpenseRecords(expenseData.records ?? []);
      setFinanceEvents((routeData.events ?? []).map((event: any) => ({
        id: String(event.id),
        name: String(event.name ?? "Unnamed event"),
        travelLegId: event.travelLegId ?? null,
      })));
    } catch (cause) {
      setFinanceError(cause instanceof Error ? cause.message : "Could not load event receipts.");
    } finally {
      setFinanceLoading(false);
    }
  }

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load wrap-up"));
    void loadFinanceEvidence();
  }, [bookingId]);

  async function act(work: () => Promise<unknown>, success: string) {
    setError(""); setMessage("");
    try { await work(); await load(); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save change"); }
  }

  function replaceExpense(next: AdminExpenseRecord) {
    setExpenseRecords((current) => {
      if (next.bookingId !== bookingId) return current.filter((row) => row.id !== next.id);
      return current.map((row) => row.id === next.id ? next : row);
    });
    void load();
  }

  if (!data) return <p>{error || "Loading event wrap-up…"}</p>;
  const trueProfit = data.calculation?.trueProfit;
  const reviewed = data.wrapUp?.status === "reviewed";
  const receiptComplete = expenseRecords.length > 0 && expenseRecords.every((record) => record.receipt?.imageStatus === "image_uploaded");

  return <div className="mx-auto grid max-w-5xl gap-5">
    <header>
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">Admin event wrap-up</p>
      <h1 className="text-3xl font-bold">{data.event.name}</h1>
      <p className="mt-1 text-slate-600">{data.event.legName}{data.event.startsAt ? ` · ${new Date(data.event.startsAt).toLocaleDateString()}` : ""} · {data.wrapUp?.status ?? "draft"}</p>
    </header>

    {data.sourceDataChanged ? <section className="rounded-xl border border-rose-300 bg-rose-50 p-4 font-semibold text-rose-800">Source finance/travel data changed after review. Reopen this wrap-up before treating it as final.</section> : null}
    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}

    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="text-xl font-bold">Occurrence rating & settlement</h2>
      <div className="flex flex-wrap gap-2" aria-label="Admin event rating">
        {[0,1,2,3,4,5].map((value) => <button key={value} className={stars === value ? "button-primary" : "button-secondary"} type="button" onClick={() => setStars(value)}>{value === 0 ? "0" : "★".repeat(value)}</button>)}
      </div>
      <label className="grid gap-1 text-sm font-semibold">Event notes<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <p><b>Expected cash:</b> {money(data.calculation?.settlement?.expectedCashCents)}</p>
        <p><b>Over / short:</b> {cashDifference(data.calculation?.settlement?.differenceCents)}</p>
        <label className="grid gap-1 text-sm font-semibold">Actual cash<input aria-label="Actual cash" value={actualCash} onChange={(e) => setActualCash(e.target.value)} /></label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">Cash difference note<textarea rows={2} value={cashNote} onChange={(e) => setCashNote(e.target.value)} /></label>
      <button className="button-secondary w-fit" type="button" onClick={() => void act(() => apiPut(`/event-wrap-up-admin/${bookingId}`, { ratingStars: stars, ratingNotes: notes.trim() || null, actualCashOnHandCents: actualCash.trim() ? centsFromDollars(actualCash) : null, cashDifferenceNote: cashNote.trim() || null }), "Wrap-up details saved.")}>Save occurrence details</button>
    </section>

    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="text-xl font-bold">Profitability</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <p><b>Direct profit:</b> {money(data.calculation?.directProfit?.profitCents)}</p>
        <p><b>Estimated true profit:</b> {trueProfit?.profitCents == null ? "Unavailable" : money(trueProfit.profitCents)}</p>
        <p><b>Receipts:</b> {financeLoading ? "Loading…" : expenseRecords.length === 0 ? "No event expenses" : receiptComplete ? "Complete" : `${expenseRecords.filter((record) => record.receipt?.imageStatus !== "image_uploaded").length} missing/incomplete`}</p>
      </div>
      {trueProfit?.profitCents == null ? <p className="font-semibold text-amber-700">Estimated true profit unavailable — {(trueProfit?.incompleteReasons ?? []).join("; ")}</p> : null}
    </section>

    <section className="grid gap-3 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-xl font-bold">Expenses & receipts</h2><p className="text-sm text-slate-600">Manager submissions tied to this event, with the entered details and receipt evidence kept together.</p></div>
        <button className="button-secondary" type="button" onClick={() => void loadFinanceEvidence()}>Refresh receipts</button>
      </div>
      {financeError ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3"><p role="alert" className="text-sm font-semibold text-rose-700">{financeError}</p><button className="button-secondary mt-2" type="button" onClick={() => void loadFinanceEvidence()}>Retry receipts</button></div> : financeLoading ? <p className="text-sm text-slate-500">Loading receipts…</p> : expenseRecords.length ? <div className="grid gap-3">{expenseRecords.map((record) => <AdminExpenseRecordCard key={record.id} record={record} events={financeEvents} onUpdated={replaceExpense} />)}</div> : <p className="rounded-lg border border-dashed bg-slate-50 p-4 text-sm text-slate-500">No expenses have been assigned to this event yet.</p>}
    </section>

    <section className="grid gap-4 rounded-xl border bg-white p-4">
      <h2 className="text-xl font-bold">Admin accounting overrides</h2>
      <div className="grid gap-2 rounded-lg border p-3">
        <h3 className="font-bold">Travel allocation</h3>
        <p className="text-sm text-slate-600">Automatic miles: {data.travel?.automaticMiles ?? 0}</p>
        <label className="grid gap-1 text-sm font-semibold">Override miles<input value={travelMiles} onChange={(e) => setTravelMiles(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Override travel cost ($)<input value={travelCost} onChange={(e) => setTravelCost(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Travel override reason<input aria-label="Travel override reason" required value={travelReason} onChange={(e) => setTravelReason(e.target.value)} /></label>
        <button className="button-secondary w-fit" disabled={!data.event.tripId || !travelReason.trim()} type="button" onClick={() => void act(() => apiPut(`/event-wrap-up-admin/${bookingId}/travel-allocation`, { tripId: data.event.tripId, overrideMiles: travelMiles.trim() ? Number(travelMiles) : null, overrideCostCents: travelCost.trim() ? centsFromDollars(travelCost) : null, reason: travelReason.trim() }), "Travel allocation saved.")}>Save travel override</button>
      </div>

      <div className="grid gap-2 rounded-lg border p-3">
        <h3 className="font-bold">Overhead</h3>
        <label className="grid gap-1 text-sm font-semibold">Label<input value={overheadLabel} onChange={(e) => setOverheadLabel(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Amount ($)<input value={overheadAmount} onChange={(e) => setOverheadAmount(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Overhead reason<input aria-label="Overhead reason" required value={overheadReason} onChange={(e) => setOverheadReason(e.target.value)} /></label>
        <button className="button-secondary w-fit" disabled={!overheadReason.trim() || centsFromDollars(overheadAmount) == null || !overheadLabel.trim()} type="button" onClick={() => void act(() => apiPut(`/event-wrap-up-admin/${bookingId}/overhead`, { amountCents: centsFromDollars(overheadAmount), label: overheadLabel.trim(), reason: overheadReason.trim() }), "Overhead saved.")}>Save overhead</button>
      </div>

      <div className="grid gap-2 rounded-lg border p-3">
        <h3 className="font-bold">Manual profit adjustment</h3>
        <select aria-label="Adjustment scope" value={adjustmentScope} onChange={(e) => setAdjustmentScope(e.target.value as any)}><option value="direct">Direct profit</option><option value="true_profit">Estimated true profit</option></select>
        <label className="grid gap-1 text-sm font-semibold">Label<input value={adjustmentLabel} onChange={(e) => setAdjustmentLabel(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Amount ($; negative allowed)<input value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Adjustment reason<input aria-label="Adjustment reason" required value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} /></label>
        <button className="button-secondary w-fit" disabled={!adjustmentReason.trim() || !adjustmentLabel.trim() || centsFromDollars(adjustmentAmount) == null} type="button" onClick={() => void act(() => apiPost(`/event-wrap-up-admin/${bookingId}/adjustments`, { scope: adjustmentScope, amountCents: centsFromDollars(adjustmentAmount), label: adjustmentLabel.trim(), reason: adjustmentReason.trim() }), "Adjustment added.")}>Add adjustment</button>
        {(data.adjustments ?? []).map((row: any) => <p key={row.id} className="text-sm"><b>{row.label}:</b> {money(row.amountCents)} · {row.reason}</p>)}
      </div>
    </section>

    <section className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
      {!reviewed ? <button className="button-primary" type="button" onClick={() => void act(() => apiPost(`/event-wrap-up-admin/${bookingId}/review`, {}), "Wrap-up marked reviewed.")}>Mark reviewed</button> : null}
      {reviewed ? <button className="button-secondary" type="button" onClick={() => void act(() => apiPost(`/event-wrap-up-admin/${bookingId}/reopen`, {}), "Wrap-up reopened.")}>Reopen wrap-up</button> : null}
      <a className="button-secondary" href="/manager-aftermath">Back to aftermath</a>
    </section>
  </div>;
}
