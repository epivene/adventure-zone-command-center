import type { IRouter } from "express";
import officeInvoicesRouter from "./office-invoices";
import bossInvoicesRouter from "./boss-invoices";

export function mountRoleScopedInvoiceRoutes(router: IRouter) {
  router.use(officeInvoicesRouter);
  router.use(bossInvoicesRouter);
}
