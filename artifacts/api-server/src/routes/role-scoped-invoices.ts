import type { IRouter, RequestHandler } from "express";
import officeInvoicesRouter from "./office-invoices";
import bossInvoicesRouter from "./boss-invoices";

export function mountRoleScopedInvoiceRoutes(router: IRouter, requireOwner: RequestHandler) {
  router.use(officeInvoicesRouter);
  router.use(bossInvoicesRouter);
  router.use(requireOwner);
}
