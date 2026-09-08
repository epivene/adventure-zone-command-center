import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { officeTaskStatusValues, officeTaskTypeValues, organizationContacts } from "@/db/schema";
import { DrizzleOfficeTaskRepository } from "@/features/office/office-task-repository";

const router: IRouter = Router();
const tasks = new DrizzleOfficeTaskRepository(db);
const uuid = z.string().uuid();
const nullableUuid = z.union([uuid, z.null()]);
const nullableText = z.union([z.string(), z.null()]).transform((value) => value?.trim() || null);
const nullableDate = z.union([z.coerce.date(), z.null()]);

const createSchema = z.object({
  officeAccountId: uuid,
  taskType: z.enum(officeTaskTypeValues),
  title: z.string().trim().min(1).max(300),
  instructions: nullableText.optional(),
  organizationId: nullableUuid.optional(),
  contactId: nullableUuid.optional(),
  dueAt: nullableDate.optional(),
}).strict();

const patchSchema = z.object({
  taskType: z.enum(officeTaskTypeValues).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  instructions: nullableText.optional(),
  organizationId: nullableUuid.optional(),
  contactId: nullableUuid.optional(),
  dueAt: nullableDate.optional(),
  status: z.enum(officeTaskStatusValues).optional(),
  needsHelp: z.boolean().optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), { message: "No task changes provided." });

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function contactBelongsToProfile(organizationId: string | null | undefined, contactId: string | null | undefined) {
  if (!contactId) return true;
  if (!organizationId) return false;
  const [relationship] = await db
    .select({ id: organizationContacts.id })
    .from(organizationContacts)
    .where(and(
      eq(organizationContacts.organizationId, organizationId),
      eq(organizationContacts.contactId, contactId),
      eq(organizationContacts.active, true),
    ))
    .limit(1);
  return Boolean(relationship);
}

router.get("/office-admin/tasks", async (req, res) => {
  const accountId = typeof req.query.accountId === "string" && uuid.safeParse(req.query.accountId).success ? req.query.accountId : null;
  res.json({ tasks: await tasks.listForOwner(accountId) });
});

router.post("/office-admin/tasks", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the task details." });
    return;
  }
  if (!(await contactBelongsToProfile(parsed.data.organizationId, parsed.data.contactId))) {
    res.status(400).json({ error: "The selected contact is not part of that profile." });
    return;
  }
  try {
    const task = await tasks.createForOwner(parsed.data);
    res.status(201).json({ task });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create office task");
    res.status(500).json({ error: "Could not create Office Coordinator task." });
  }
});

router.patch("/office-admin/tasks/:taskId", async (req, res): Promise<void> => {
  const taskId = param(req.params.taskId);
  const parsed = patchSchema.safeParse(req.body);
  if (!uuid.safeParse(taskId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid task ID." : parsed.error.issues[0]?.message ?? "Review the task changes." });
    return;
  }
  const task = await tasks.updateForOwner(taskId, parsed.data);
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.json({ task });
});

router.delete("/office-admin/tasks/:taskId", async (req, res): Promise<void> => {
  const taskId = param(req.params.taskId);
  if (!uuid.safeParse(taskId).success) {
    res.status(400).json({ error: "Invalid task ID." });
    return;
  }
  const deleted = await tasks.deleteForOwner(taskId);
  if (!deleted) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.json({ ok: true });
});

router.post("/office-admin/tasks/reorder", async (req, res): Promise<void> => {
  const parsed = z.object({ accountId: uuid, taskIds: z.array(uuid).min(1).max(500) }).strict().safeParse(req.body);
  if (!parsed.success || new Set(parsed.success ? parsed.data.taskIds : []).size !== (parsed.success ? parsed.data.taskIds.length : 0)) {
    res.status(400).json({ error: "Provide one ordered list of unique task IDs." });
    return;
  }
  const ok = await tasks.reorderForOwner(parsed.data.accountId, parsed.data.taskIds);
  if (!ok) {
    res.status(409).json({ error: "The Office Coordinator queue changed. Refresh and reorder again." });
    return;
  }
  res.json({ ok: true });
});

export default router;
