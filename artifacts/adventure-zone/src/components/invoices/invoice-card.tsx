import { useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import type { InvoiceRecord, InvoiceWorkspaceClient } from "@/features/invoices/invoice-types";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { PaymentEditor } from "./payment-editor";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function InvoiceCard({
  invoice,
  api,
  onChanged,
  onOpenDocument,
}: {
  invoice: InvoiceRecord;
  api: InvoiceWorkspaceClient;
  onChanged(): void;
  onOpenDocument(documentId: string): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function voidPayment(paymentId: string) {
    if (!window.confirm("Void this payment? The record will stay in the audit history.")) return;
    setBusy(true);
    setError("");
    try { await api.voidPayment(invoice.id, paymentId); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not void the payment."); }
    finally { setBusy(false); }
  }

  async function cancelInvoice() {
    if (!window.confirm("Cancel this invoice? Its payment history will be preserved.")) return;
    setBusy(true);
    setError("");
    try { await api.update(invoice.id, { status: "cancelled" }); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not cancel the invoice."); }
    finally { setBusy(false); }
  }

  return <article className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm" data-testid="invoice-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{invoice.invoiceNumber}</p>
        <h3 className="truncate text-lg font-black">{invoice.organizationName}</h3>
        {invoice.bookingName ? <p className="text-sm text-muted-foreground">{invoice.bookingName}</p> : null}
      </div>
      <InvoiceStatusBadge status={invoice.effectiveStatus} />
    </div>
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div><p className="text-muted-foreground">Total</p><p className="font-bold">{money.format(invoice.totalCents / 100)}</p></div>
      <div><p className="text-muted-foreground">Paid</p><p className="font-bold">{money.format(invoice.paidCents / 100)}</p></div>
      <div className="col-span-2"><p className="text-muted-foreground">Balance</p><p className="font-black">{money.format(invoice.remainingCents / 100)} remaining</p></div>
    </div>
    {invoice.nextDueDate ? <p className="text-sm text-muted-foreground">Next due: <span className="font-semibold text-foreground">{invoice.nextDueDate}</span></p> : null}
    {invoice.creditCents > 0 ? <p className="rounded-lg bg-emerald-50 p-2 text-sm font-bold text-emerald-800">{money.format(invoice.creditCents / 100)} credit</p> : null}
    {invoice.payments.length ? <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-bold">Payment history ({invoice.payments.length})</summary><div className="mt-2 grid gap-2">{invoice.payments.map((payment) => <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm" key={payment.id}><span className={payment.voidedAt ? "line-through text-muted-foreground" : ""}>{money.format(payment.amountCents / 100)} · {payment.receivedDate}{payment.method ? ` · ${payment.method}` : ""}</span>{payment.voidedAt ? <span className="text-xs font-bold text-muted-foreground">Voided</span> : <Button disabled={busy} onClick={() => void voidPayment(payment.id)} size="sm" type="button" variant="ghost">Void</Button>}</div>)}</div></details> : null}
    {error ? <p className="text-sm font-semibold text-destructive" role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => onOpenDocument(invoice.documentId)} size="sm" type="button" variant="outline">Open PDF</Button>
      {invoice.storedStatus !== "cancelled" ? <PaymentEditor api={api} invoiceId={invoice.id} onSaved={onChanged} /> : null}
      {invoice.storedStatus !== "cancelled" ? <Button disabled={busy} onClick={() => void cancelInvoice()} size="sm" type="button" variant="ghost">Cancel invoice</Button> : null}
    </div>
  </article>;
}
