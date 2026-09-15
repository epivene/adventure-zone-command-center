import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { invoiceStatusValues } from "@workspace/db/invoice-schema";

import { InvoiceServiceError } from "@/features/invoices/invoice-service";

type InvoiceRouteService = {
  list(filters: { organizationId?: string; bookingId?: string; status?: typeof invoiceStatusValues[number] }, today?: Date): Promise<unknown>;
  summary(filters: { organizationId?: string; bookingId?: string; status?: typeof invoiceStatusValues[number] }, today?: Date): Promise<unknown>;
  detail(invoiceId: string, today?: Date): Promise<unknown>;
  create(input: unknown, actor: string, today?: Date): Promise<unknown>;
  update(invoiceId: string, input: unknown, actor: string, today?: Date): Promise<unknown>;
  recordPayment(invoiceId: string, input: unknown, actor: string, today?: Date): Promise<unknown>;
  voidPayment(invoiceId: string, paymentId: string, actor: string, today?: Date): Promise<unknown>;
};

const uuid = z.string().uuid();
const listQuery = z.object({
  organizationId: uuid.optional(),
  bookingId: uuid.optional(),
  status: z.enum(invoiceStatusValues).optional(),
}).strict();

function actor(req: Request) {
  return req.bossAccount
    ? `boss:${req.bossAccount.accountId}`
    : req.officeAccount
      ? `office:${req.officeAccount.accountId}`
      : String((req as Request & { userId?: string }).userId ?? "owner");
}

function id(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function respondError(res: Response, error: unknown) {
  if (error instanceof InvoiceServiceError) {
    const status = error.code === "INVOICE_NOT_FOUND"
      ? 404
      : error.code === "INVOICE_NUMBER_EXISTS"
        ? 409
        : 400;
    res.status(status).json({ error: error.message, code: error.code, fields: error.fields });
    return;
  }
  res.status(503).json({ error: "Invoice tracking is temporarily unavailable.", code: "INVOICE_UNAVAILABLE" });
}

export function createInvoicesRouter(service: InvoiceRouteService): IRouter {
  const router = Router();

  router.get("/invoices", async (req, res) => {
    try {
      const query = listQuery.parse(req.query);
      res.json({ invoices: await service.list(query) });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid invoice filters.", code: "INVOICE_FILTERS_INVALID" });
      else respondError(res, error);
    }
  });

  router.get("/invoices/summary", async (req, res) => {
    try {
      const query = listQuery.parse(req.query);
      res.json({ summary: await service.summary(query) });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid invoice filters.", code: "INVOICE_FILTERS_INVALID" });
      else respondError(res, error);
    }
  });

  router.get("/invoices/:invoiceId", async (req, res) => {
    try {
      const invoiceId = uuid.parse(id(req.params.invoiceId));
      res.json({ invoice: await service.detail(invoiceId) });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid invoice ID.", code: "INVOICE_ID_INVALID" });
      else respondError(res, error);
    }
  });

  router.post("/invoices", async (req, res) => {
    try {
      res.status(201).json({ invoice: await service.create(req.body, actor(req)) });
    } catch (error) {
      respondError(res, error);
    }
  });

  router.patch("/invoices/:invoiceId", async (req, res) => {
    try {
      const invoiceId = uuid.parse(id(req.params.invoiceId));
      res.json({ invoice: await service.update(invoiceId, req.body, actor(req)) });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid invoice ID.", code: "INVOICE_ID_INVALID" });
      else respondError(res, error);
    }
  });

  router.post("/invoices/:invoiceId/payments", async (req, res) => {
    try {
      const invoiceId = uuid.parse(id(req.params.invoiceId));
      res.status(201).json({ invoice: await service.recordPayment(invoiceId, req.body, actor(req)) });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid invoice ID.", code: "INVOICE_ID_INVALID" });
      else respondError(res, error);
    }
  });

  router.post("/invoices/:invoiceId/payments/:paymentId/void", async (req, res) => {
    try {
      const invoiceId = uuid.parse(id(req.params.invoiceId));
      const paymentId = uuid.parse(id(req.params.paymentId));
      res.json({ invoice: await service.voidPayment(invoiceId, paymentId, actor(req)) });
    } catch (error) {
      if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid invoice or payment ID.", code: "INVOICE_ID_INVALID" });
      else respondError(res, error);
    }
  });

  return router;
}
