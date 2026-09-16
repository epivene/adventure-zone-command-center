import { DrizzleInvoiceRepository } from "@/features/invoices/invoice-repository";
import { InvoiceService } from "@/features/invoices/invoice-service";
import { createInvoicesRouter } from "./invoices";

export function createDefaultInvoicesRouter() {
  return createInvoicesRouter(new InvoiceService(new DrizzleInvoiceRepository()));
}

export default createDefaultInvoicesRouter();
