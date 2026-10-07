import { Link } from "wouter";
import InvoicesContractsPage from "./InvoicesContractsPage";
import { businessDocumentsApi } from "@/lib/business-documents-api";
import { contractsWorkspaceApi, invoicesApi } from "@/lib/invoices-api";

export default function OwnerInvoicesContractsPage() {
  return <div className="grid gap-4"><nav aria-label="Document areas" className="flex flex-wrap gap-2">
    <Link className="rounded-lg border px-3 py-3 text-sm font-semibold" href="/business-documents">Saved files</Link>
    <span aria-current="page" className="rounded-lg bg-secondary px-3 py-3 text-sm font-semibold">Contracts &amp; Invoices</span>
  </nav><InvoicesContractsPage contractApi={contractsWorkspaceApi} documentApi={businessDocumentsApi} invoiceApi={invoicesApi} eyebrow="Owner workspace" /></div>;
}
