import InvoicesContractsPage from "./InvoicesContractsPage";
import { officeBusinessDocumentsApi } from "@/lib/office-documents-api";
import { officeContractsWorkspaceApi, officeInvoicesApi } from "@/lib/invoices-api";

export default function OfficeInvoicesContractsPage() {
  return <InvoicesContractsPage contractApi={officeContractsWorkspaceApi} documentApi={officeBusinessDocumentsApi} invoiceApi={officeInvoicesApi} eyebrow="Office workspace" />;
}
