import { eq, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { officeAccounts, officeTaskTypeValues } from "@/db/schema";
import { DrizzleOfficeTaskRepository } from "@/features/office/office-task-repository";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();
const tasks = new DrizzleOfficeTaskRepository(db);

const createTaskSchema = z.object({
  assignee: z.string().trim().min(1).max(120),
  taskType: z.enum(officeTaskTypeValues).default("follow_up_prep"),
  title: z.string().trim().min(1).max(300),
  instructions: z.string().trim().min(1).max(4000),
  organizationId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
}).strict();

router.use(requireAssistantImportToken);

router.post("/office-tasks", async (req, res): Promise<void> => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the task details." });
    return;
  }

  const assignee = parsed.data.assignee.trim();
  const matches = await db
    .select({ id: officeAccounts.id, displayName: officeAccounts.displayName, loginName: officeAccounts.loginName })
    .from(officeAccounts)
    .where(sql`${officeAccounts.enabled} = true and (lower(trim(${officeAccounts.displayName})) = lower(trim(${assignee})) or lower(trim(${officeAccounts.loginName})) = lower(trim(${assignee})))`)
    .limit(2);

  if (matches.length === 0) {
    res.status(404).json({ ok: false, error: `No enabled Office Coordinator account matches ${assignee}.` });
    return;
  }
  if (matches.length > 1) {
    res.status(409).json({ ok: false, error: `More than one Office Coordinator account matches ${assignee}.` });
    return;
  }

  try {
    const task = await tasks.createForOwner({
      officeAccountId: matches[0]!.id,
      taskType: parsed.data.taskType,
      title: parsed.data.title,
      instructions: parsed.data.instructions,
      organizationId: parsed.data.organizationId ?? null,
      contactId: parsed.data.contactId ?? null,
      dueAt: parsed.data.dueAt ?? null,
    });
    res.status(201).json({
      ok: true,
      assignee: matches[0]!.displayName,
      taskId: task.id,
      title: task.title,
      dueAt: task.dueAt,
    });
  } catch (error) {
    req.log.error({ err: error, assignee }, "Failed assistant office task creation");
    res.status(500).json({ ok: false, error: "Office task could not be created." });
  }
});

export default router;
