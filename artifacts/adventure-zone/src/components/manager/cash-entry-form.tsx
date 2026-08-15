import { useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import { ManagerSyncStatus } from "./manager-sync-status";

const kinds = [
  ["advance_received", "Advance received"],
  ["cash_turned_in", "Cash turned in"],
  ["cash_returned", "Cash returned"],
  ["manager_reimbursed", "Manager reimbursed"],
  ["adjustment", "Adjustment"],
] as const;

export function CashEntryForm({ tripId = null }: { tripId?: string | null }) {
  const { manager, managerApi } = useManagerAuth();
  const [kind, setKind] = useState("cash_turned_in");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!manager) return;
    const amountCents = Math.round((Number(amount) || 0) * 100);
    if (kind !== "adjustment" && amountCents < 0) return;
    const id = crypto.randomUUID();
    const body = {
      tripId,
      bookingId: null,
      tripSegmentId: null,
      kind,
      amountCents,
      occurredAt: new Date().toISOString(),
      notes: notes.trim() || null,
      clientMutationId: id,
    };
    await queueManagerMutation({
      id,
      legId: manager.legId,
      method: "POST",
      path: "/manager/cash",
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
      <h2 className="font-bold">Cash flow</h2>
      <label className="grid gap-1 text-sm font-semibold">
        Cash action
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          {kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Cash amount
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </label>
      <p className="text-sm text-slate-600">Cash turned in or returned lowers the Adventure Zone cash you still need to account for.</p>
      <label className="grid gap-1 text-sm font-semibold">
        Cash notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
      </label>
      <button className="button-primary">Save cash entry</button>
      {state ? <ManagerSyncStatus state={state} /> : null}
    </form>
  );
}
