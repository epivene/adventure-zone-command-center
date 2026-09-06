import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleAdminFinanceRepository } from "@/features/leg-manager/admin-finance-repository";
import { financeAssignmentSources } from "@/features/leg-manager/admin-finance-types";
import { enrichAdminExpenseRecord, enrichAdminExpenseRecords } from "@/features/leg-manager/admin-finance-record-service";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";

const router: IRouter = Router();
const finance = new DrizzleAdminFinanceRepository(db);
const storage = new GoogleCloudLegManagerObjectStorage();
const expenseIdSchema = z.string().uuid();
const filtersSchema = z.object({
  legId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  category: z.string().trim().min(1).optional(),
  paymentSource: z.string().trim().min(1).optional(),
  assignmentSource: z.enum(financeAssignmentSources).optional(),
  receiptStatus: z.enum(["attached", "missing", "incomplete"]).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
const updateSchema = z.object({
  merchant: z.string().trim().max(240).nullable().optional(),
  category: z.enum(["fuel", "food", "rv_park", "vehicle_maintenance", "trailer_maintenance", "supplies", "employee_related", "other"]).optional(),
  amountCents: z.number().int().min(0).optional(),
  taxCents: z.number().int().min(0).optional(),
  paymentSource: z.enum(["adventure_zone_cash", "adventure_zone_debit", "personal"]).optional(),
  occurredAt: z.coerce.date().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  tripId: z.string().uuid().nullable().optional(),
  tripSegmentId: z.string().uuid().nullable().optional(),
  changeReason: z.string().trim().max(1000).nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "changeReason"), { message: "At least one expense field is required" });

router.get("/manager-admin/finance/expenses", async (req, res): Promise<void> => {
  const parsed = filtersSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid finance filters" }); return; }
  const rows = await finance.listAdminExpenses(parsed.data);
  const auditPairs = await Promise.all(rows.map(async (row) => [row.id, await finance.listExpenseAudit(row.id)] as const));
  res.json({ records: await enrichAdminExpenseRecords(rows, new Map(auditPairs), storage) });
});

router.get("/manager-admin/finance/expenses/:expenseId", async (req, res): Promise<void> => {
  const parsedId = expenseIdSchema.safeParse(req.params.expenseId);
  if (!parsedId.success) { res.status(400).json({ error: "Invalid expense id" }); return; }
  const row = await finance.getAdminExpense(parsedId.data);
  if (!row) { res.status(404).json({ error: "Expense not found" }); return; }
  res.json({ record: await enrichAdminExpenseRecord(row, await finance.listExpenseAudit(row.id), storage) });
});

router.patch("/manager-admin/finance/expenses/:expenseId", async (req, res): Promise<void> => {
  const parsedId = expenseIdSchema.safeParse(req.params.expenseId);
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsed.success) { res.status(400).json({ error: "Invalid expense update" }); return; }
  try {
    const row = await finance.updateAdminExpense(parsedId.data, parsed.data, { actorId: null, actorLabel: "Desie/admin" });
    if (!row) { res.status(404).json({ error: "Expense not found" }); return; }
    res.json({ record: await enrichAdminExpenseRecord(row, await finance.listExpenseAudit(row.id), storage) });
  } catch (error) {
    if (error instanceof Error && error.message === "OUTSIDE_LEG") {
      res.status(409).json({ error: "That event or travel assignment does not belong to this leg" });
      return;
    }
    throw error;
  }
});

export default router;
