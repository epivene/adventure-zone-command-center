import { useEffect, useState } from "react";
import { apiPatch } from "@/lib/auth-token";

export type AdminExpenseRecord = {
  id: string;
  legId: string;
  legName: string;
  submitterName: string | null;
  bookingId: string | null;
  bookingName: string | null;
  tripId: string | null;
  tripSegmentId: string | null;
  assignmentSource: "legacy" | "explicit" | "automatic" | "admin" | "unassigned";
  assignmentReason: string | null;
  merchant: string | null;
  category: string;
  amountCents: number;
  taxCents: number;
  totalCents: number;
  paymentSource: string;
  occurredAt: string;
  notes: string | null;
  employeeNote: string | null;
  submittedAt: string;
  updatedAt: string;
  receipt: null | { id: string; imageStatus: string; mimeType: string | null; imageUrl: string | null };
  audit: Array<{
    id: string;
    actorId: string | null;
    actorLabel: string;
    changeReason: string | null;
    previousValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    changedAt: string;
  }>;
  warning?: "receipt_image_unavailable";
};

export type FinanceEventOption = {
  id: string;
  name: string;
  travelLegId: string | null;
};

const categories = [
  ["fuel", "Fuel"], ["food", "Food"], ["rv_park", "RV park"],
  ["vehicle_maintenance", "Vehicle maintenance"], ["trailer_maintenance", "Trailer maintenance"],
  ["supplies", "Supplies"], ["employee_related", "Employee related"], ["other", "Other"],
] as const;

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100);
}

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function toCents(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function label(value: string) {
  return value.split("_").map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : part).join(" ");
}

export function AdminExpenseRecordCard({
  record,
  events = [],
  onUpdated,
}: {
  record: AdminExpenseRecord;
  events?: FinanceEventOption[];
  onUpdated?: (record: AdminExpenseRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [merchant, setMerchant] = useState(record.merchant ?? "");
  const [category, setCategory] = useState(record.category);
  const [amount, setAmount] = useState(dollars(record.amountCents));
  const [tax, setTax] = useState(dollars(record.taxCents));
  const [paymentSource, setPaymentSource] = useState(record.paymentSource);
  const [date, setDate] = useState(record.occurredAt.slice(0, 10));
  const [notes, setNotes] = useState(record.notes ?? "");
  const [bookingId, setBookingId] = useState(record.bookingId ?? "");
  const [changeReason, setChangeReason] = useState("");

  useEffect(() => {
    setMerchant(record.merchant ?? "");
    setCategory(record.category);
    setAmount(dollars(record.amountCents));
    setTax(dollars(record.taxCents));
    setPaymentSource(record.paymentSource);
    setDate(record.occurredAt.slice(0, 10));
    setNotes(record.notes ?? "");
    setBookingId(record.bookingId ?? "");
  }, [record]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await apiPatch<{ record: AdminExpenseRecord }>(`/manager-admin/finance/expenses/${record.id}`, {
        merchant: merchant.trim() || null,
        category,
        amountCents: toCents(amount),
        taxCents: toCents(tax),
        paymentSource,
        occurredAt: new Date(`${date}T12:00:00`).toISOString(),
        notes: notes.trim() || null,
        bookingId: bookingId || null,
        changeReason: changeReason.trim() || null,
      });
      onUpdated?.(response.record);
      setEditing(false);
      setChangeReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update expense.");
    } finally {
      setSaving(false);
    }
  }

  const scope = record.bookingName || (record.assignmentSource === "unassigned" ? "General / Unassigned" : label(record.assignmentSource));
  const legEvents = events.filter((event) => !event.travelLegId || event.travelLegId === record.legId);

  return <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <button className="w-full p-4 text-left" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-slate-950">{record.merchant || label(record.category)}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{scope}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {new Date(record.occurredAt).toLocaleDateString()} · {record.submitterName || record.legName} · {label(record.category)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {record.receipt?.imageStatus === "image_uploaded" ? "Receipt attached" : record.receipt ? "Receipt upload incomplete" : "No receipt attached"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{money(record.totalCents)}</p>
          <span className="text-xs font-semibold text-orange-700">{open ? "Hide" : "View receipt & details"}</span>
        </div>
      </div>
    </button>

    {open ? <div className="grid gap-4 border-t border-slate-200 p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="grid gap-2 text-sm">
          <p><b>Submitted by:</b> {record.submitterName || record.legName}</p>
          <p><b>Submitted:</b> {new Date(record.submittedAt).toLocaleString()}</p>
          <p><b>Assignment:</b> {scope}{record.assignmentReason ? ` · ${record.assignmentReason}` : ""}</p>
          <p><b>Subtotal:</b> {money(record.amountCents)} · <b>Tax:</b> {money(record.taxCents)} · <b>Total:</b> {money(record.totalCents)}</p>
          <p><b>Payment source:</b> {label(record.paymentSource)}</p>
          {record.notes ? <p><b>Notes:</b> {record.notes}</p> : null}
          {record.employeeNote ? <p><b>Employee note:</b> {record.employeeNote}</p> : null}
        </div>
        <div>
          {record.receipt?.imageUrl ? <a className="block" href={record.receipt.imageUrl} target="_blank" rel="noreferrer">
            <img className="max-h-72 w-full rounded-lg border object-contain" alt={`Receipt for ${record.merchant || record.category}`} src={record.receipt.imageUrl} />
            <span className="mt-1 block text-center text-xs font-semibold text-orange-700">Open full receipt</span>
          </a> : <div className="grid min-h-32 place-items-center rounded-lg border border-dashed bg-slate-50 p-3 text-center text-sm text-slate-500">
            {record.warning === "receipt_image_unavailable" ? "Receipt image is temporarily unavailable. The expense details are still saved." : record.receipt ? "Receipt image has not finished uploading." : "No receipt photo was submitted."}
          </div>}
        </div>
      </div>

      {!editing ? <button className="button-secondary w-fit" type="button" onClick={() => setEditing(true)}>Edit finance details</button> : <div className="grid gap-3 rounded-lg border bg-slate-50 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">Merchant<input value={merchant} onChange={(e) => setMerchant(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-semibold">Subtotal ($)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Tax ($)<input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Payment source<select value={paymentSource} onChange={(e) => setPaymentSource(e.target.value)}><option value="adventure_zone_cash">Adventure Zone cash</option><option value="adventure_zone_debit">Adventure Zone company debit</option><option value="personal">Personal money/card</option></select></label>
          <label className="grid gap-1 text-sm font-semibold">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Event assignment<select value={bookingId} onChange={(e) => setBookingId(e.target.value)}><option value="">General / Unassigned</option>{legEvents.map((event) => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label>
        </div>
        <label className="grid gap-1 text-sm font-semibold">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Correction note <span className="font-normal text-slate-500">(optional)</span><input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Why was this changed?" /></label>
        {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
        <div className="flex gap-2"><button className="button-primary" disabled={saving} type="button" onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button><button className="button-secondary" disabled={saving} type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </div>}

      {record.audit.length ? <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-bold">Change history ({record.audit.length})</summary><div className="mt-2 grid gap-2">{record.audit.map((entry) => <div key={entry.id} className="text-xs text-slate-600"><p className="font-semibold">{entry.actorLabel} · {new Date(entry.changedAt).toLocaleString()}</p>{entry.changeReason ? <p>{entry.changeReason}</p> : null}<p>{Object.keys(entry.newValues).map((key) => `${key}: ${String(entry.previousValues[key] ?? "—")} → ${String(entry.newValues[key] ?? "—")}`).join(" · ")}</p></div>)}</div></details> : null}
    </div> : null}
  </article>;
}
