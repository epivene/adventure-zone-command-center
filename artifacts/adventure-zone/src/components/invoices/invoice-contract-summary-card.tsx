import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { ContractWorkspaceRecord, InvoiceAttentionSummary, InvoiceWorkspaceClient } from "@/features/invoices/invoice-types";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function InvoiceContractSummaryCard({
  invoiceApi,
  contractApi,
  organizationId,
  bookingId,
}: {
  invoiceApi: InvoiceWorkspaceClient;
  contractApi: { list(filters?: { organizationId?: string; bookingId?: string }): Promise<{ contracts: ContractWorkspaceRecord[] }> };
  organizationId?: string;
  bookingId?: string;
}) {
  const [summary, setSummary] = useState<InvoiceAttentionSummary | null>(null);
  const [contracts, setContracts] = useState(0);

  useEffect(() => {
    let current = true;
    const scope = { organizationId, bookingId };
    Promise.all([invoiceApi.summary(scope), contractApi.list(scope)])
      .then(([invoiceResult, contractResult]) => {
        if (!current) return;
        setSummary(invoiceResult.summary);
        setContracts(contractResult.contracts.length);
      })
      .catch(() => { if (current) setSummary(null); });
    return () => { current = false; };
  }, [bookingId, contractApi, invoiceApi, organizationId]);

  if (!summary) return null;
  return <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">Invoices &amp; Contracts</h2><p className="text-sm text-muted-foreground">Payment and contract status for this record.</p></div><Link className="button-secondary text-sm" href="/invoices-contracts">Open workspace</Link></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">Outstanding</p><p className="font-black">{money.format(summary.outstandingCents / 100)}</p></div>
      <div><p className="text-xs text-muted-foreground">Overdue</p><p className="font-black">{summary.overdueCount}</p></div>
      <div><p className="text-xs text-muted-foreground">Invoices</p><p className="font-black">{summary.totalInvoices}</p></div>
      <div><p className="text-xs text-muted-foreground">Contracts</p><p className="font-black">{contracts}</p></div>
    </div>
  </section>;
}
