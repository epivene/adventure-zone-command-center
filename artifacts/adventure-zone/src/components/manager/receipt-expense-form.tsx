import { useRef, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import { flushManagerBlobQueue, queueManagerBlob } from "@/lib/manager-blob-queue";
import { ManagerSyncStatus } from "./manager-sync-status";

const categories = [
  ["fuel", "Fuel"], ["food", "Food"], ["rv_park", "RV park"],
  ["vehicle_maintenance", "Vehicle maintenance"], ["trailer_maintenance", "Trailer maintenance"],
  ["supplies", "Supplies"], ["employee_related", "Employee related"], ["other", "Other"],
] as const;

type Suggestions = { merchant: string | null; totalCents: number | null; taxCents: number | null; occurredAt: string | null };
type SaveState = "saved_offline" | "synced" | "needs_attention";
export type ReceiptEventOption = { id: string; name: string; startsAt?: string | null };
const dollars = (cents: number | null | undefined) => cents == null ? "" : (cents / 100).toFixed(2);
const toCents = (value: string) => Math.round((Number(value) || 0) * 100);

export function ReceiptExpenseForm({ mode, bookingId = null, events = [], onDone }: { mode: "receipt" | "manual"; bookingId?: string | null; events?: ReceiptEventOption[]; onDone?: (state: SaveState) => void }) {
  const { manager, managerApi } = useManagerAuth();
  const [file, setFile] = useState<File | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [expenseId] = useState(() => crypto.randomUUID());
  const [receiptId] = useState(() => crypto.randomUUID());
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("fuel");
  const [source, setSource] = useState("adventure_zone_debit");
  const [notes, setNotes] = useState("");
  const [selectedBookingId, setBookingId] = useState(bookingId ?? "");
  const [extracting, setExtracting] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState("");
  const [state, setState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);

  function applySuggestions(suggestions: Suggestions | null) {
    if (!suggestions) return;
    if (suggestions.merchant) setMerchant(suggestions.merchant);
    if (suggestions.totalCents != null) setAmount(dollars(suggestions.totalCents));
    if (suggestions.taxCents != null) setTax(dollars(suggestions.taxCents));
    if (suggestions.occurredAt) setDate(suggestions.occurredAt.slice(0, 10));
  }

  async function chooseReceipt(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected || !manager) return;
    setFile(selected);
    await queueManagerBlob({ id: receiptId, legId: manager.legId, receiptId, kind: "receipt", blob: selected, createdAt: new Date().toISOString() });
    if (!navigator.onLine) {
      setExtractionMessage("Photo saved offline. Enter the expense details now; the image will sync later.");
      return;
    }
    setExtracting(true);
    setExtractionMessage("Reading receipt…");
    try {
      const result = await managerApi<{ suggestions: Suggestions | null; unavailable: boolean }>("/manager/receipts/extract", {
        method: "POST",
        headers: { "Content-Type": selected.type || "image/jpeg" },
        body: selected,
      });
      applySuggestions(result.suggestions);
      setExtractionMessage(result.suggestions ? "Receipt read. Check the details before saving." : "Could not read the receipt. Enter the details manually.");
    } catch {
      setExtractionMessage("Could not read the receipt. Enter the details manually; your photo is still saved.");
    } finally {
      setExtracting(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!manager || toCents(amount) <= 0) return;
    const now = new Date().toISOString();
    await queueManagerMutation({
      id: expenseId,
      legId: manager.legId,
      method: "POST",
      path: "/manager/expenses",
      body: {
        id: expenseId,
        bookingId: selectedBookingId || null,
        tripId: null,
        tripSegmentId: null,
        category,
        merchant: merchant.trim() || null,
        amountCents: toCents(amount),
        taxCents: toCents(tax),
        paymentSource: source,
        occurredAt: new Date(`${date}T12:00:00`).toISOString(),
        notes: notes.trim() || null,
        employeeNote: null,
        clientMutationId: expenseId,
      },
      createdAt: now,
    });
    if (file) {
      await queueManagerMutation({
        id: receiptId,
        legId: manager.legId,
        method: "POST",
        path: "/manager/receipts",
        body: { id: receiptId, expenseId, clientMutationId: receiptId, mimeType: file.type || "image/jpeg" },
        createdAt: new Date(Date.now() + 1).toISOString(),
      });
    }
    setState("saved_offline");
    let finalState: SaveState = "saved_offline";
    if (navigator.onLine) {
      setState("syncing");
      const rows = await flushManagerMutationQueue(managerApi);
      const expenseRow = rows.find((row) => row.id === expenseId);
      const receiptRow = rows.find((row) => row.id === receiptId);
      if (expenseRow?.state === "needs_attention" || (file && receiptRow?.state === "needs_attention")) {
        setState("needs_attention");
        onDone?.("needs_attention");
        return;
      }
      if (file && receiptRow?.state === "synced") {
        const blobs = await flushManagerBlobQueue(
          async row => {
            await managerApi(`/manager/receipts/${row.receiptId}/image`, {
              method: "PUT",
              headers: { "Content-Type": row.blob.type || "image/jpeg" },
              body: row.blob,
            });
          },
          undefined,
          async row => row.kind === "receipt" && row.receiptId === receiptId,
        );
        if (blobs.find((row) => row.id === receiptId)?.state === "image_failed") {
          setState("needs_attention");
          onDone?.("needs_attention");
          return;
        }
      }
      setState("synced");
      finalState = "synced";
    }
    onDone?.(finalState);
  }

  const sortedEvents = [...events].sort((a, b) => new Date(b.startsAt ?? 0).getTime() - new Date(a.startsAt ?? 0).getTime());

  return <form onSubmit={save} className="grid gap-3 rounded-xl border bg-white p-4">
    <h2 className="font-bold">{mode === "receipt" ? "Add receipt" : "Add expense manually"}</h2>
    {selectedBookingId ? <p className="text-xs font-semibold text-orange-700">This expense is attached to an event. Change it below if needed.</p> : null}
    {mode === "receipt" ? <div className="grid gap-2">
      <span className="text-sm font-semibold">Receipt photo</span>
      <div className="grid grid-cols-2 gap-2">
        <button className="button-secondary" type="button" onClick={() => cameraRef.current?.click()}>Take photo</button>
        <button className="button-secondary" type="button" onClick={() => galleryRef.current?.click()}>Choose from gallery</button>
      </div>
      <input ref={cameraRef} className="sr-only" aria-label="Take receipt photo" type="file" accept="image/*" capture="environment" onChange={chooseReceipt} />
      <input ref={galleryRef} className="sr-only" aria-label="Choose receipt from gallery" type="file" accept="image/*" onChange={chooseReceipt} />
      {file ? <p className="text-sm text-slate-600">Selected: {file.name}</p> : null}
    </div> : null}
    {extractionMessage ? <p role="status" className="text-sm text-slate-600">{extractionMessage}</p> : null}
    <label className="grid gap-1 text-sm font-semibold">Merchant<input value={merchant} onChange={event => setMerchant(event.target.value)} /></label>
    <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm font-semibold">Total<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required /></label><label className="grid gap-1 text-sm font-semibold">Tax<input inputMode="decimal" value={tax} onChange={event => setTax(event.target.value)} /></label></div>
    <label className="grid gap-1 text-sm font-semibold">Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label className="grid gap-1 text-sm font-semibold">Category<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="grid gap-1 text-sm font-semibold">Payment source<select value={source} onChange={event => setSource(event.target.value)}><option value="adventure_zone_cash">Adventure Zone cash</option><option value="adventure_zone_debit">Adventure Zone company debit</option><option value="personal">Personal money/card</option></select></label>
    <label className="grid gap-1 text-sm font-semibold">Event assignment<select value={selectedBookingId} onChange={event => setBookingId(event.target.value)}><option value="">General / Unassigned</option>{sortedEvents.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm font-semibold">Notes<textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} /></label>
    <button className="button-primary" disabled={extracting || state === "syncing"}>{extracting ? "Reading receipt…" : state === "syncing" ? "Saving…" : "Save expense"}</button>
    {state ? <ManagerSyncStatus state={state} /> : null}
  </form>;
}
