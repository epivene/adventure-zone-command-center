import InvoicesContractsPage from "./InvoicesContractsPage";
import { bossBusinessDocumentsApi } from "@/lib/boss-documents-api";
import { bossContractsWorkspaceApi, bossInvoicesApi } from "@/lib/invoices-api";

export default function BossInvoicesContractsPage() {
  return <InvoicesContractsPage contractApi={bossContractsWorkspaceApi} documentApi={bossBusinessDocumentsApi} invoiceApi={bossInvoicesApi} eyebrow="Boss workspace" />;
}
