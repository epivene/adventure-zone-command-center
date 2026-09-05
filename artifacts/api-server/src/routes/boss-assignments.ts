import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { bossAssignments, officeAccounts } from "@/db/schema";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { requireOwnerMiddleware } from "@/lib/auth";

const router: IRouter = Router(), requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const assignmentId = z.string().uuid();
const input = z.object({
  assigneeKind: z.enum(["office", "owner"]), officeAccountId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300), details: z.string().trim().max(12000).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(), dueAt: z.coerce.date().nullable().optional(),
  status: z.enum(["todo", "in_progress", "waiting", "done", "cancelled"]).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.assigneeKind === "office" && !value.officeAccountId) ctx.addIssue({ code: "custom", message: "Choose an Office Coordinator." });
  if (value.assigneeKind === "owner" && value.officeAccountId) ctx.addIssue({ code: "custom", message: "Owner assignments cannot have an Office Coordinator." });
});
const patch = input.partial().strict().refine(v => Object.keys(v).length > 0, "No assignment changes provided.");
const routeId = (x: string | string[] | undefined) => Array.isArray(x) ? x[0] ?? "" : x ?? "";
async function validOffice(id: string) { return (await db.select({ id: officeAccounts.id }).from(officeAccounts).where(and(eq(officeAccounts.id, id), eq(officeAccounts.enabled, true))).limit(1))[0]; }
router.get("/boss/assignments", requireBoss, async (_req, res) => res.json({ assignments: await db.select().from(bossAssignments).orderBy(desc(bossAssignments.createdAt)) }));
router.get("/boss/assignment-targets", requireBoss, async (_req, res) => res.json({
  owner: { kind: "owner", displayName: "Owner" },
  officeAccounts: await db.select({ id: officeAccounts.id, displayName: officeAccounts.displayName }).from(officeAccounts).where(eq(officeAccounts.enabled, true)).orderBy(asc(officeAccounts.displayName)),
}));
router.post("/boss/assignments", requireBoss, async (req, res): Promise<void> => {
  const value = input.safeParse(req.body); if (!value.success) { res.status(400).json({ error: value.error.issues[0]?.message ?? "Review the assignment." }); return; }
  if (value.data.assigneeKind === "office" && !(await validOffice(value.data.officeAccountId!))) { res.status(400).json({ error: "Choose an enabled Office Coordinator." }); return; }
  const [assignment] = await db.insert(bossAssignments).values({ ...value.data, officeAccountId: value.data.assigneeKind === "owner" ? null : value.data.officeAccountId!, details: value.data.details ?? null, dueAt: value.data.dueAt ?? null, createdByBossId: req.bossAccount!.accountId, status: value.data.status ?? "todo", priority: value.data.priority ?? "normal", completedAt: value.data.status === "done" ? new Date() : null }).returning();
  res.status(201).json({ assignment });
});
router.patch("/boss/assignments/:assignmentId", requireBoss, async (req, res): Promise<void> => {
  const id = routeId(req.params.assignmentId), value = patch.safeParse(req.body); if (!assignmentId.safeParse(id).success || !value.success) { res.status(400).json({ error: value.success ? "Invalid assignment ID." : value.error.issues[0]?.message ?? "Review the assignment." }); return; }
  const next = value.data; if (next.assigneeKind === "office" && !next.officeAccountId) { res.status(400).json({ error: "Choose an Office Coordinator." }); return; }
  if (next.officeAccountId && !(await validOffice(next.officeAccountId))) { res.status(400).json({ error: "Choose an enabled Office Coordinator." }); return; }
  const [assignment] = await db.update(bossAssignments).set({ ...next, updatedAt: new Date(), ...(next.status === "done" ? { completedAt: new Date() } : next.status ? { completedAt: null } : {}) }).where(eq(bossAssignments.id, id)).returning();
  if (!assignment) { res.status(404).json({ error: "Assignment not found." }); return; } res.json({ assignment });
});
router.delete("/boss/assignments/:assignmentId", requireBoss, async (req, res) => { const id = routeId(req.params.assignmentId); if (!assignmentId.safeParse(id).success) { res.status(400).json({ error: "Invalid assignment ID." }); return; } const rows = await db.delete(bossAssignments).where(eq(bossAssignments.id, id)).returning({ id: bossAssignments.id }); if (!rows[0]) { res.status(404).json({ error: "Assignment not found." }); return; } res.status(204).end(); });
router.get("/owner/boss-assignments", requireOwnerMiddleware, async (_req, res) => res.json({ assignments: await db.select().from(bossAssignments).where(eq(bossAssignments.assigneeKind, "owner")).orderBy(asc(bossAssignments.dueAt), desc(bossAssignments.createdAt)) }));
export default router;