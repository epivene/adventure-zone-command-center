import InvoicesContractsPage from "./InvoicesContractsPage";
import { businessDocumentsApi } from "@/lib/business-documents-api";
import { contractsWorkspaceApi, invoicesApi } from "@/lib/invoices-api";

export default function OwnerInvoicesContractsPage() {
  return <InvoicesContractsPage contractApi={contractsWorkspaceApi} documentApi={businessDocumentsApi} invoiceApi={invoicesApi} eyebrow="Owner workspace" />;
}
