import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { ContractWorkspaceRecord, InvoiceWorkspaceClient } from "@/features/invoices/invoice-types";
import { latestInvoiceContractSeason } from "@/features/invoices/invoice-contract-season";
import type { BusinessDocumentRecord } from "@/lib/business-documents-api";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Summary = ReturnType<typeof latestInvoiceContractSeason>;

export function InvoiceContractSummaryCard({
  invoiceApi,
  contractApi,
  documentApi,
  organizationId,
  bookingId,
}: {
  invoiceApi: InvoiceWorkspaceClient;
  contractApi: { list(filters?: { organizationId?: string; bookingId?: string }): Promise<{ contracts: ContractWorkspaceRecord[] }> };
  documentApi?: { listAll(filters: { profileId: string; category: "contract" }): Promise<{ documents: BusinessDocumentRecord[] }> };
  organizationId?: string;
  bookingId?: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let current = true;
    const scope = { organizationId, bookingId };
    Promise.all([
      invoiceApi.list(scope),
      contractApi.list(scope),
      organizationId && documentApi
        ? documentApi.listAll({ profileId: organizationId, category: "contract" })
        : Promise.resolve({ documents: [] as BusinessDocumentRecord[] }),
    ])
      .then(([invoiceResult, contractResult, documentResult]) => {
        if (!current) return;
        setSummary(latestInvoiceContractSeason({
          invoices: invoiceResult.invoices,
          contracts: contractResult.contracts,
          contractDocuments: documentResult.documents,
        }));
      })
      .catch(() => { if (current) setSummary(null); });
    return () => { current = false; };
  }, [bookingId, contractApi, documentApi, invoiceApi, organizationId]);

  if (!summary) return null;
  return <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">Invoices &amp; Contracts</h2><p className="text-sm text-muted-foreground">Payment and contract status for {summary.year && summary.year !== "unknown" ? summary.year : "this record"}.</p></div><Link className="button-secondary text-sm" href="/invoices-contracts">Open workspace</Link></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">Outstanding</p><p className="font-black">{money.format(summary.outstandingCents / 100)}</p></div>
      <div><p className="text-xs text-muted-foreground">Overdue</p><p className="font-black">{summary.overdueCount}</p></div>
      <div><p className="text-xs text-muted-foreground">Invoices</p><p className="font-black">{summary.totalInvoices}</p></div>
      <div><p className="text-xs text-muted-foreground">Contracts</p><p className="font-black">{summary.contracts}</p></div>
    </div>
  </section>;
}
