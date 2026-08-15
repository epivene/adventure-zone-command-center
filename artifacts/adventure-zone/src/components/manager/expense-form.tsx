import { useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import { ManagerSyncStatus } from "./manager-sync-status";

const categories = [
  ["fuel", "Fuel"],
  ["food", "Food"],
  ["rv_park", "RV park"],
  ["vehicle_maintenance", "Vehicle maintenance"],
  ["trailer_maintenance", "Trailer maintenance"],
  ["supplies", "Supplies"],
  ["employee_related", "Employee related"],
  ["other", "Other"],
] as const;

export function ExpenseForm({
  bookingId = null,
  tripId = null,
  tripSegmentId = null,
}: {
  bookingId?: string | null;
  tripId?: string | null;
  tripSegmentId?: string | null;
}) {
  const { manager, managerApi } = useManagerAuth();
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [category, setCategory] = useState("fuel");
  const [source, setSource] = useState("adventure_zone_debit");
  const [merchant, setMerchant] = useState("");
  const [employeeNote, setEmployeeNote] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);
  const cents = (value: string) => Math.round((Number(value) || 0) * 100);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!manager || cents(amount) <= 0) return;
    const id = crypto.randomUUID();
    const body = {
      bookingId,
      tripId,
      tripSegmentId,
      category,
      merchant: merchant.trim() || null,
      amountCents: cents(amount),
      taxCents: cents(tax),
      paymentSource: source,
      occurredAt: new Date().toISOString(),
      notes: notes.trim() || null,
      employeeNote: employeeNote.trim() || null,
      clientMutationId: id,
    };
    await queueManagerMutation({
      id,
      legId: manager.legId,
      method: "POST",
      path: "/manager/expenses",
      body,
      createdAt: new Date().toISOString(),
    });
    setState("saved_offline");
    if (navigator.onLine) {
      setState("syncing");
      const rows = await flushManagerMutationQueue(managerApi);
      setState(rows.find((row) => row.id === id)?.state ?? "synced");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="font-bold">Expense</h2>
      <label className="grid gap-1 text-sm font-semibold">
        Category
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Merchant
        <input value={merchant} onChange={(event) => setMerchant(event.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Tax
          <input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Payment source
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="adventure_zone_cash">Adventure Zone cash</option>
          <option value="adventure_zone_debit">Adventure Zone company debit</option>
          <option value="personal">Personal money/card</option>
        </select>
      </label>
      {source === "personal" ? (
        <p className="rounded-lg bg-amber-50 p-2 text-sm">Adventure Zone owes you reimbursement for approved personal expenses.</p>
      ) : source === "adventure_zone_debit" ? (
        <p className="text-sm text-slate-600">Company debit spending is a company expense and does not create personal reimbursement.</p>
      ) : (
        <p className="text-sm text-slate-600">This reduces Adventure Zone cash you are holding.</p>
      )}
      <label className="grid gap-1 text-sm font-semibold">
        Employee note
        <input value={employeeNote} onChange={(event) => setEmployeeNote(event.target.value)} placeholder="Optional — who made the purchase" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
      </label>
      <button className="button-primary">Save expense</button>
      {state ? <ManagerSyncStatus state={state} /> : null}
    </form>
  );
}
