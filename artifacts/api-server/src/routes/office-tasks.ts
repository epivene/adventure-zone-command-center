import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { DrizzleOfficeEmailRepository } from "@/features/office/office-email-repository";
import { DrizzleOfficeMessageRepository } from "@/features/office/office-message-repository";
import { DrizzleOfficeTaskRepository } from "@/features/office/office-task-repository";
import { bossAssignments } from "@/db/schema";
import { and, desc, eq, notInArray } from "drizzle-orm";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const tasks = new DrizzleOfficeTaskRepository(db);
const drafts = new DrizzleOfficeEmailRepository(db);
const messages = new DrizzleOfficeMessageRepository(db);
const taskIdSchema = z.string().uuid();
const patchSchema = z.object({
  status: z.enum(["todo", "in_progress", "waiting", "done"]).optional(),
  coordinatorNote: z.union([z.string().max(8000), z.null()]).optional().transform((value) => typeof value === "string" ? value.trim() || null : value),
  needsHelp: z.boolean().optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), { message: "No task changes provided." });
const assignmentPatchSchema = z.object({
  status: z.enum(["todo", "in_progress", "waiting", "done"]),
}).strict();

router.get("/office/tasks", requireOffice, async (req, res) => {
  const view = req.query.view === "done" ? "done" : "active";
  const status = view === "done" ? "done" : undefined;
  const assignments = await db.select().from(bossAssignments).where(and(
    eq(bossAssignments.officeAccountId, req.officeAccount!.accountId),
    ...(status
      ? [eq(bossAssignments.status, status)]
      : [notInArray(bossAssignments.status, ["done", "cancelled"])]),
  )).orderBy(desc(bossAssignments.createdAt));
  res.json({ tasks: await tasks.listForOffice(req.officeAccount!.accountId, view), bossAssignments: assignments });
});

router.patch("/office/boss-assignments/:assignmentId", requireOffice, async (req, res): Promise<void> => {
  const assignmentId = Array.isArray(req.params.assignmentId) ? req.params.assignmentId[0] : req.params.assignmentId;
  const parsedId = taskIdSchema.safeParse(assignmentId);
  const parsed = assignmentPatchSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid assignment ID." : parsed.error.issues[0]?.message ?? "Review the assignment change." });
    return;
  }
  const [assignment] = await db.update(bossAssignments).set({
    status: parsed.data.status,
    completedAt: parsed.data.status === "done" ? new Date() : null,
    updatedAt: new Date(),
  }).where(and(
    eq(bossAssignments.id, assignmentId),
    eq(bossAssignments.officeAccountId, req.officeAccount!.accountId),
  )).returning();
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found." });
    return;
  }
  res.json({ assignment });
});

router.get("/office/today", requireOffice, async (req, res) => {
  const accountId = req.officeAccount!.accountId;
  const [taskSummary, needsChanges, unreadMessages] = await Promise.all([
    tasks.todayForOffice(accountId),
    drafts.listNeedsChanges(accountId),
    messages.unreadCount(accountId, "office"),
  ]);
  res.json({ ...taskSummary, needsChanges, unreadMessages });
});

router.patch("/office/tasks/:taskId", requireOffice, async (req, res): Promise<void> => {
  const taskId = Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId;
  const parsedId = taskIdSchema.safeParse(taskId);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid task ID." : parsed.error.issues[0]?.message ?? "Review the task changes." });
    return;
  }

  const accountId = req.officeAccount!.accountId;
  if (parsed.data.status === "done") {
    const activeTasks = await tasks.listForOffice(accountId, "active");
    const current = activeTasks.find((item) => item.id === taskId);
    if (current?.type === "mail_brochure") {
      res.status(409).json({ error: "Record the brochure as mailed to complete this task." });
      return;
    }
  }

  const task = await tasks.updateForOffice(taskId, accountId, parsed.data);
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.json({ task });
});

export default router;
