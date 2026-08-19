import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { ReceiptCapture } from "@/components/manager/receipt-capture";
import { ReceiptExpenseForm, type ReceiptEventOption } from "@/components/manager/receipt-expense-form";
import { ManagerSyncStatus } from "@/components/manager/manager-sync-status";

const categories = [
  ["fuel", "Fuel"], ["food", "Food"], ["rv_park", "RV park"],
  ["vehicle_maintenance", "Vehicle maintenance"], ["trailer_maintenance", "Trailer maintenance"],
  ["supplies", "Supplies"], ["employee_related", "Employee related"], ["other", "Other"],
] as const;

const paymentSources = [
  ["adventure_zone_cash", "Adventure Zone cash"],
  ["adventure_zone_debit", "Adventure Zone company debit"],
  ["personal", "Personal money/card"],
] as const;

type Receipt = {
  id: string;
  imageStatus: string;
  imageUrl?: string | null;
  mimeType?: string | null;
};

type Expense = {
  id: string;
  bookingId?: string | null;
  category: string;
  merchant: string | null;
  amountCents: number;
  taxCents: number;
  paymentSource: string;
  occurredAt: string;
  notes: string | null;
  receiptStatus?: string;
  receipts?: Receipt[];
};

type Notice = { state: "saved_offline" | "synced" | "needs_attention"; text?: string } | null;

type CurrentLifecycleResponse = { lifecycle: null | { bookingId: string; bookingName?: string | null; checkedInAt?: string | null } };
type ManagerRouteResponse = { events?: Array<{ bookingId: string; bookingName: string; startsAt?: string | null }> };

function dollars(cents: number) { return (cents / 100).toFixed(2); }
function dateInput(value: string) { return new Date(value).toISOString().slice(0, 10); }

function ExpenseCard({ expense, reload, showNotice }: { expense: Expense; reload(): Promise<void>; showNotice(notice: Notice): void }) {
  const { managerApi } = useManagerAuth();
  const [editing, setEditing] = useState(false);
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [amount, setAmount] = useState(dollars(expense.amountCents));
  const [tax, setTax] = useState(dollars(expense.taxCents));
  const [category, setCategory] = useState(expense.category);
  const [paymentSource, setPaymentSource] = useState(expense.paymentSource);
  const [date, setDate] = useState(dateInput(expense.occurredAt));
  const [notes, setNotes] = useState(expense.notes ?? "");
  const [busy, setBusy] = useState(false);
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const [replaceReceiptId, setReplaceReceiptId] = useState<string | null>(null);
  const receipts = expense.receipts ?? [];

  async function saveEdit() {
    if (busy || Number(amount) <= 0) return;
    setBusy(true);
    try {
      await managerApi(`/manager/expenses/${expense.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          merchant: merchant.trim() || null,
          amountCents: Math.round(Number(amount) * 100),
          taxCents: Math.round((Number(tax) || 0) * 100),
          category,
          paymentSource,
          occurredAt: new Date(`${date}T12:00:00`).toISOString(),
          notes: notes.trim() || null,
        }),
      });
      setEditing(false);
      showNotice({ state: "synced", text: "Expense changes saved." });
      await reload();
    } catch (error) {
      showNotice({ state: "needs_attention", text: error instanceof Error ? error.message : "Could not save expense changes." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteExpense() {
    if (!window.confirm("Delete this expense and its receipt photo(s)? This cannot be undone.")) return;
    setBusy(true);
    try {
      await managerApi(`/manager/expenses/${expense.id}`, { method: "DELETE" });
      showNotice({ state: "synced", text: "Expense deleted." });
      await reload();
    } catch (error) {
      showNotice({ state: "needs_attention", text: error instanceof Error ? error.message : "Could not delete expense." });
    } finally {
      setBusy(false);
    }
  }

  async function deletePhoto(receiptId: string) {
    if (!window.confirm("Remove this receipt photo?")) return;
    setBusy(true);
    try {
      await managerApi(`/manager/receipts/${receiptId}`, { method: "DELETE" });
      showNotice({ state: "synced", text: "Receipt photo removed." });
      await reload();
    } catch (error) {
      showNotice({ state: "needs_attention", text: error instanceof Error ? error.message : "Could not remove receipt photo." });
    } finally {
      setBusy(false);
    }
  }

  function chooseReplacement(receiptId: string) {
    setReplaceReceiptId(receiptId);
    replaceRef.current?.click();
  }

  async function replacePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const receiptId = replaceReceiptId;
    event.target.value = "";
    if (!file || !receiptId) return;
    if (!navigator.onLine) {
      showNotice({ state: "needs_attention", text: "Connect to the internet to replace an already-saved receipt photo." });
      return;
    }
    setBusy(true);
    try {
      await managerApi(`/manager/receipts/${receiptId}/image`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      showNotice({ state: "synced", text: "Receipt photo replaced." });
      await reload();
    } catch (error) {
      showNotice({ state: "needs_attention", text: error instanceof Error ? error.message : "Could not replace receipt photo." });
    } finally {
      setBusy(false);
      setReplaceReceiptId(null);
    }
  }

  if (editing) {
    return <section className="grid gap-3 rounded-xl border border-orange-200 bg-white p-4 shadow-sm">
      <h2 className="font-bold">Edit expense</h2>
      <label className="grid gap-1 text-sm font-semibold">Merchant<input value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-semibold">Total<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Tax<input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} /></label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">Payment source<select value={paymentSource} onChange={(event) => setPaymentSource(event.target.value)}>{paymentSources.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy} type="button" onClick={() => void saveEdit()}>{busy ? "Saving…" : "Save changes"}</button><button className="button-secondary" disabled={busy} type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    </section>;
  }

  return <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div><p className="font-semibold">{expense.merchant || expense.category} — ${dollars(expense.amountCents + expense.taxCents)}</p><p className="mt-1 text-sm text-slate-600">{new Date(expense.occurredAt).toLocaleDateString()} · {expense.category.replaceAll("_", " ")} · {paymentSources.find(([value]) => value === expense.paymentSource)?.[1] ?? expense.paymentSource}</p>{expense.notes ? <p className="mt-2 text-sm text-slate-700">{expense.notes}</p> : null}</div>
      <button className="text-sm font-semibold text-orange-700" type="button" onClick={() => setEditing(true)}>Edit expense</button>
    </div>

    {receipts.length ? <div className="grid gap-3">
      {receipts.map((receipt) => <div className="rounded-xl border border-slate-200 p-3" key={receipt.id}>
        {receipt.imageUrl ? <a className="block w-fit" href={receipt.imageUrl} rel="noreferrer" target="_blank"><img alt="Receipt" className="max-h-56 max-w-full rounded-lg border object-contain" src={receipt.imageUrl} /><span className="mt-2 block text-sm font-semibold text-orange-700">Open photo</span></a> : receipt.imageStatus === "image_failed" ? <p className="text-sm font-semibold text-rose-700">Receipt photo upload failed.</p> : receipt.imageStatus === "image_pending" ? <p className="text-sm font-semibold text-amber-700">Receipt photo is waiting to upload.</p> : <p className="text-sm text-slate-600">Receipt photo unavailable. Refresh to try again.</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button className="button-secondary" disabled={busy} type="button" onClick={() => chooseReplacement(receipt.id)}>Replace photo</button><button className="button-secondary" disabled={busy} type="button" onClick={() => void deletePhoto(receipt.id)}>Remove photo</button></div>
      </div>)}
    </div> : <ReceiptCapture expenseId={expense.id} onDone={reload} />}

    <input className="sr-only" ref={replaceRef} type="file" accept="image/*" aria-label="Replace receipt photo" onChange={replacePhoto} />
    <button className="w-fit text-sm font-semibold text-rose-700" disabled={busy} type="button" onClick={() => void deleteExpense()}>Delete expense</button>
  </section>;
}

export default function ManagerReceiptsPage() {
  const { managerApi } = useManagerAuth();
  const search = useSearch();
  const bookingId = new URLSearchParams(search).get("bookingId");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [mode, setMode] = useState<"receipt" | "manual" | null>(bookingId ? "receipt" : null);
  const [notice, setNotice] = useState<Notice>(null);
  const [currentBookingId, setCurrentBookingId] = useState<string | null>(null);
  const [eventOptions, setEventOptions] = useState<ReceiptEventOption[]>([]);

  async function load() {
    try {
      const summary = await managerApi<{ expenses?: Expense[] }>("/manager/money/records");
      setExpenses(summary.expenses ?? []);
    } catch {
      setExpenses([]);
    }
  }

  useEffect(() => { void load(); }, [managerApi]);

  useEffect(() => {
    Promise.all([
      managerApi<CurrentLifecycleResponse>("/manager/events/lifecycle/current").catch(() => ({ lifecycle: null })),
      managerApi<ManagerRouteResponse>("/manager/route").catch(() => ({ events: [] })),
    ]).then(([lifecycleData, routeData]) => {
      const current = lifecycleData.lifecycle;
      setCurrentBookingId(current?.bookingId ?? null);
      const options = (routeData.events ?? []).map((event) => ({ id: event.bookingId, name: event.bookingName, startsAt: event.startsAt ?? null }));
      if (current && !options.some((event) => event.id === current.bookingId)) {
        options.push({ id: current.bookingId, name: current.bookingName ?? "Current checked-in event", startsAt: current.checkedInAt ?? null });
      }
      setEventOptions(options);
    });
  }, [managerApi]);

  function saved(state: "saved_offline" | "synced" | "needs_attention") {
    setNotice({ state, text: state === "synced" ? "Expense and receipt saved." : state === "saved_offline" ? "Expense saved on this device." : "The expense was saved, but something needs attention." });
    setMode(null);
    void load();
  }

  const defaultBookingId = bookingId ?? currentBookingId;

  return <div className="grid gap-4">
    <header><h1 className="text-2xl font-bold">Receipts</h1><p className="text-sm text-slate-600">Take a photo and let the app fill in the receipt details, or add an expense manually.</p>{bookingId ? <p className="mt-1 text-sm font-semibold text-orange-700">Adding this from an event wrap-up.</p> : currentBookingId ? <p className="mt-1 text-sm font-semibold text-orange-700">New expenses default to your currently checked-in event.</p> : null}</header>
    {notice ? <div className="grid gap-1"><ManagerSyncStatus state={notice.state} />{notice.text ? <p className="text-sm text-slate-600">{notice.text}</p> : null}</div> : null}
    <div className="flex flex-wrap gap-2"><button className="button-primary" onClick={() => { setNotice(null); setMode("receipt"); }}>+ Add receipt</button><button className="button-secondary" onClick={() => { setNotice(null); setMode("manual"); }}>Add expense manually</button></div>
    {mode ? <ReceiptExpenseForm key={`${mode}:${defaultBookingId ?? ""}`} mode={mode} bookingId={defaultBookingId} events={eventOptions} onDone={saved} /> : null}
    {expenses.length ? expenses.map((expense) => <ExpenseCard key={expense.id} expense={expense} reload={load} showNotice={setNotice} />) : <section className="rounded-xl border border-dashed bg-white p-5 text-center"><p className="font-semibold">No expenses yet.</p><p className="mt-1 text-sm text-slate-600">Use Add receipt to scan your first one.</p></section>}
  </div>;
}
