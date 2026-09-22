import { useCallback, useEffect, useState } from "react";
import { FileSignature, Plus, ReceiptText, RefreshCw } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import type { BusinessDocumentProfileOption, BusinessDocumentRecord } from "@/lib/business-documents-api";
import type {
  ContractWorkspaceRecord,
  InvoiceAttentionSummary,
  InvoiceRecord,
  InvoiceStatus,
  InvoiceWorkspaceClient,
} from "@/features/invoices/invoice-types";
import { InvoiceCard } from "@/components/invoices/invoice-card";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";

type ContractClient = {
  list(filters?: { organizationId?: string; bookingId?: string; status?: string }): Promise<{ contracts: ContractWorkspaceRecord[] }>;
};

type DocumentClient = {
  upload(file: File, metadata: { displayName: string; category: "invoice" }): Promise<{ documentId?: string }>;
  deleteDocument(documentId: string): Promise<unknown>;
  open(documentId: string): Promise<string>;
  searchProfiles(query: string): Promise<BusinessDocumentProfileOption[]>;
  list(filters: { profileId: string; category: "invoice"; limit: number }): Promise<{
    documents: Array<{ id: string; displayName: string }>;
  }>;
  listAll(filters: { category: "contract" }): Promise<{ documents: BusinessDocumentRecord[] }>;
};

const emptySummary: InvoiceAttentionSummary = {
  totalInvoices: 0,
  overdueCount: 0,
  overdueCents: 0,
  depositDueCount: 0,
  outstandingCents: 0,
};
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function InvoicesContractsPage({
  invoiceApi,
  contractApi,
  documentApi,
  eyebrow = "Business records",
}: {
  invoiceApi: InvoiceWorkspaceClient;
  contractApi: ContractClient;
  documentApi: DocumentClient;
  eyebrow?: string;
}) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [contracts, setContracts] = useState<ContractWorkspaceRecord[]>([]);
  const [contractDocuments, setContractDocuments] = useState<BusinessDocumentRecord[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [invoiceResult, summaryResult, contractResult, contractDocumentResult] = await Promise.all([
        invoiceApi.list(status ? { status } : {}),
        invoiceApi.summary(),
        contractApi.list(),
        documentApi.listAll({ category: "contract" }),
      ]);
      setInvoices(invoiceResult.invoices);
      setSummary(summaryResult.summary);
      setContracts(contractResult.contracts);
      setContractDocuments(contractDocumentResult.documents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load invoice and contract records.");
    } finally {
      setLoading(false);
    }
  }, [contractApi, documentApi, invoiceApi, status, reload]);

  useEffect(() => { void load(); }, [load]);

  async function openDocument(documentId: string) {
    try {
      const url = await documentApi.open(documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the PDF.");
    }
  }

  return <div className="grid gap-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">{eyebrow}</p><h1 className="mt-1 text-3xl font-black">Invoices &amp; Contracts</h1><p className="mt-1 text-sm text-muted-foreground">Track invoice PDFs, deposits, balances, due dates, and contract progress together.</p></div>
      <div className="flex gap-2"><Button onClick={() => setReload((value) => value + 1)} type="button" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => setEditing(true)} type="button"><Plus className="mr-2 h-4 w-4" />Add invoice</Button></div>
    </header>

    <section aria-label="Invoice summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Overdue balances</p><p className="mt-1 text-2xl font-black">{summary.overdueCount}</p><p className="text-sm font-bold text-destructive">{money.format(summary.overdueCents / 100)}</p></div>
      <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Deposits due</p><p className="mt-1 text-2xl font-black">{summary.depositDueCount}</p></div>
      <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Outstanding</p><p className="mt-1 text-2xl font-black">{money.format(summary.outstandingCents / 100)}</p></div>
      <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Invoices tracked</p><p className="mt-1 text-2xl font-black">{summary.totalInvoices}</p></div>
    </section>

    {editing ? <InvoiceEditor api={invoiceApi} documentApi={documentApi} onCancel={() => setEditing(false)} onCreated={() => { setEditing(false); setReload((value) => value + 1); }} /> : null}
    {error ? <p className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive" role="alert">{error}</p> : null}

    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 text-2xl font-black"><ReceiptText className="h-5 w-5" />Invoices</h2><p className="text-sm text-muted-foreground">Payments are calculated from the non-voided payment history.</p></div><label className="grid gap-1 text-sm font-semibold">Invoice status<select aria-label="Invoice status" onChange={(event) => setStatus(event.target.value as InvoiceStatus | "")} value={status}><option value="">All statuses</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="deposit_due">Deposit due</option><option value="deposit_paid">Deposit paid</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select></label></div>
      {loading ? <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Loading invoice records…</p> : invoices.length ? <div className="grid gap-4 lg:grid-cols-2">{invoices.map((invoice) => <InvoiceCard api={invoiceApi} invoice={invoice} key={invoice.id} onChanged={() => setReload((value) => value + 1)} onOpenDocument={(id) => void openDocument(id)} />)}</div> : <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No invoices match this view.</p>}
    </section>

    <section className="grid gap-4">
      <div><h2 className="flex items-center gap-2 text-2xl font-black"><FileSignature className="h-5 w-5" />Contracts</h2><p className="text-sm text-muted-foreground">Contract workflow records and uploaded contract PDFs are shown together.</p></div>
      {contracts.length || contractDocuments.length ? <div className="grid gap-3 lg:grid-cols-2">
        {contracts.map((contract) => <article className="grid gap-2 rounded-xl border bg-card p-4" key={`lifecycle-${contract.id}`}><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{contract.organizationName}</h3><p className="text-sm text-muted-foreground">{contract.bookingName}</p></div><span className="rounded-full border px-2 py-1 text-xs font-bold capitalize">{contract.status.replaceAll("_", " ")}</span></div><p className="text-xs text-muted-foreground">Version {contract.versionNumber} · Updated {contract.updatedAt.slice(0, 10)}</p></article>)}
        {contractDocuments.map((document) => {
          const linkedLabel = document.links.map((link) => link.targetLabel).filter(Boolean).join(" · ");
          return <article className="grid gap-3 rounded-xl border bg-card p-4" key={`document-${document.id}`}>
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{document.displayName}</h3><p className="text-sm text-muted-foreground">{linkedLabel || document.originalFilename}</p></div><span className="rounded-full border px-2 py-1 text-xs font-bold capitalize">{document.lifecycle === "archived" ? "Archived" : "Contract file"}</span></div>
            <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Updated {document.updatedAt.slice(0, 10)}</p><Button disabled={!document.fileAvailable} onClick={() => void openDocument(document.id)} size="sm" type="button" variant="outline">Open PDF</Button></div>
          </article>;
        })}
      </div> : !loading ? <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No contracts to show.</p> : null}
    </section>
  </div>;
}
