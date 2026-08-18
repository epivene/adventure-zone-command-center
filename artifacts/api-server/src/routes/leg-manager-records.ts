import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";

import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { DrizzleFinanceRepository } from "@/features/leg-manager/finance-repository";
import { legExpenseCategories, legPaymentSources } from "@/features/leg-manager/finance-types";
import {
  deleteExpenseReceiptObjects,
  deleteReceipt,
  DrizzleReceiptMetadataStore,
} from "@/features/leg-manager/receipt-service";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { DrizzleIncidentRepository } from "@/features/leg-manager/incident-repository";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const finance = new DrizzleFinanceRepository(db);
const receipts = new DrizzleReceiptMetadataStore(db);
const storage = new GoogleCloudLegManagerObjectStorage();
const incidents = new DrizzleIncidentRepository(db);

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const expensePatch = z.object({
  category: z.enum(legExpenseCategories).optional(),
  merchant: z.string().trim().max(200).nullable().optional(),
  amountCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().optional(),
  paymentSource: z.enum(legPaymentSources).optional(),
  occurredAt: z.coerce.date().optional(),
  notes: z.string().max(4000).nullable().optional(),
  employeeNote: z.string().max(1000).nullable().optional(),
  detailJson: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "No expense changes provided" });

const incidentPatch = z.object({
  type: z.string().trim().min(1).max(120).optional(),
  occurredAt: z.coerce.date().optional(),
  locationText: z.string().trim().max(500).nullable().optional(),
  peopleInvolved: z.string().trim().max(2000).nullable().optional(),
  description: z.string().trim().min(1).max(12000).optional(),
  actionTaken: z.string().trim().max(8000).nullable().optional(),
  followUpNeeded: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "No incident changes provided" });

router.get("/manager/money/records", requireManager, async (req, res) => {
  const legId = req.legManager!.legId;
  const tripId = typeof req.query.tripId === "string" ? req.query.tripId : null;
  const summary = await finance.summary(legId, tripId);
  const expenses = await Promise.all(summary.expenses.map(async (expense: any) => ({
    ...expense,
    receipts: await Promise.all((expense.receipts ?? []).map(async (receipt: any) => {
      let imageUrl: string | null = null;
      if (receipt.imageStatus === "image_uploaded" && receipt.objectKey) {
        try {
          imageUrl = await storage.getSignedReadUrl(receipt.objectKey);
        } catch {
          imageUrl = null;
        }
      }
      return { ...receipt, imageUrl };
    })),
  })));
  res.json({ ...summary, expenses });
});

router.patch("/manager/expenses/:expenseId", requireManager, async (req, res): Promise<void> => {
  const parsed = expensePatch.safeParse(req.body);
  const expenseId = routeParam(req.params.expenseId);
  if (!expenseId || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Expense id is required" : parsed.error.issues[0]?.message ?? "Invalid expense changes" });
    return;
  }
  const expense = await finance.updateExpenseForLeg(req.legManager!.legId, expenseId, parsed.data);
  if (!expense) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  res.json({ expense });
});

router.delete("/manager/expenses/:expenseId", requireManager, async (req, res): Promise<void> => {
  const expenseId = routeParam(req.params.expenseId);
  const legId = req.legManager!.legId;
  if (!expenseId) {
    res.status(400).json({ error: "Expense id is required" });
    return;
  }
  const expense = await finance.getExpenseForLeg(legId, expenseId);
  if (!expense) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  try {
    await deleteExpenseReceiptObjects(receipts, storage, { legId, expenseId });
  } catch {
    res.status(503).json({ error: "Could not remove stored receipt images" });
    return;
  }
  await finance.deleteExpenseForLeg(legId, expenseId);
  res.json({ ok: true });
});

router.delete("/manager/receipts/:receiptId", requireManager, async (req, res): Promise<void> => {
  const receiptId = routeParam(req.params.receiptId);
  if (!receiptId) {
    res.status(400).json({ error: "Receipt id is required" });
    return;
  }
  try {
    const result = await deleteReceipt(receipts, storage, { legId: req.legManager!.legId, receiptId });
    if (!result.ok) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Could not remove receipt image" });
    return;
  }
  res.json({ ok: true });
});

router.patch("/manager/incidents/:incidentId", requireManager, async (req, res): Promise<void> => {
  const incidentId = routeParam(req.params.incidentId);
  const parsed = incidentPatch.safeParse(req.body);
  if (!incidentId || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Incident id is required" : parsed.error.issues[0]?.message ?? "Invalid incident changes" });
    return;
  }
  const incident = await incidents.updateIncidentForLeg(req.legManager!.legId, incidentId, parsed.data);
  if (!incident) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json({ incident });
});

router.delete("/manager/incidents/:incidentId", requireManager, async (req, res): Promise<void> => {
  const incidentId = routeParam(req.params.incidentId);
  const legId = req.legManager!.legId;
  if (!incidentId) {
    res.status(400).json({ error: "Incident id is required" });
    return;
  }
  const incident = await incidents.getForLeg(legId, incidentId);
  if (!incident) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const attachments = await incidents.listAttachmentsForIncidents([incidentId], legId);
  try {
    for (const attachment of attachments) {
      if (attachment.objectKey && storage.delete) await storage.delete(attachment.objectKey);
    }
  } catch {
    res.status(503).json({ error: "Could not remove incident images" });
    return;
  }
  await incidents.deleteIncidentForLeg(legId, incidentId);
  res.json({ ok: true });
});

export default router;
