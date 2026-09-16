import { useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import type { InvoiceWorkspaceClient } from "@/features/invoices/invoice-types";

function cents(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function PaymentEditor({
  invoiceId,
  api,
  onSaved,
}: {
  invoiceId: string;
  api: InvoiceWorkspaceClient;
  onSaved(): void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (cents(amount) <= 0) {
      setError("Enter a payment amount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.recordPayment(invoiceId, { amountCents: cents(amount), receivedDate, method: method.trim() || null });
      setOpen(false);
      setAmount("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Button onClick={() => setOpen(true)} size="sm" type="button">Record payment</Button>;
  return <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3">
    <label className="grid gap-1 text-sm font-semibold">Payment amount
      <input aria-label="Payment amount" inputMode="decimal" onChange={(event) => setAmount(event.target.value)} placeholder="3000.00" value={amount} />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Received date
      <input aria-label="Received date" onChange={(event) => setReceivedDate(event.target.value)} type="date" value={receivedDate} />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Method
      <input aria-label="Payment method" onChange={(event) => setMethod(event.target.value)} placeholder="Check, cash, ACH…" value={method} />
    </label>
    {error ? <p className="text-sm font-semibold text-destructive" role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => void save()} size="sm" type="button">Save payment</Button>
      <Button disabled={busy} onClick={() => setOpen(false)} size="sm" type="button" variant="outline">Cancel</Button>
    </div>
  </div>;
}
