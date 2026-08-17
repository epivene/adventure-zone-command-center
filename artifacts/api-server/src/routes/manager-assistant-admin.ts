import { Router, type IRouter } from "express";
import { z } from "zod";

import { PostgresAdminQuestionRepository } from "@/features/manager-assistant/admin-question-repository";
import {
  OperationsKnowledgeRepository,
} from "@/features/manager-assistant/operations-knowledge-repository";

const router: IRouter = Router();
const questions = new PostgresAdminQuestionRepository();
const knowledge = new OperationsKnowledgeRepository();
const uuid = z.string().uuid();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/admin/manager-assistant/questions", async (_req, res) => {
  res.json({ questions: await questions.listOpenForAdmin() });
});

router.get("/admin/manager-assistant/questions/:questionId", async (req, res): Promise<void> => {
  const parsed = uuid.safeParse(param(req.params.questionId));
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid question id." });
    return;
  }
  const question = await questions.getById(parsed.data);
  if (!question) {
    res.status(404).json({ error: "Admin question not found." });
    return;
  }
  res.json({
    question,
    responses: await questions.listResponses(question.id),
  });
});

router.post("/admin/manager-assistant/questions/:questionId/respond", async (req, res): Promise<void> => {
  const questionId = uuid.safeParse(param(req.params.questionId));
  const body = z.string().trim().min(1).max(12000).safeParse(req.body?.body);
  if (!questionId.success || !body.success) {
    res.status(400).json({ error: "Enter a response." });
    return;
  }
  const question = await questions.getById(questionId.data);
  if (!question) {
    res.status(404).json({ error: "Admin question not found." });
    return;
  }
  if (question.status === "resolved") {
    res.status(409).json({ error: "This question is already resolved." });
    return;
  }
  const response = await questions.addResponse({
    questionId: question.id,
    actorType: "admin",
    actorId: (req as any).userId ?? "owner",
    body: body.data,
  });
  res.status(201).json({ response });
});

router.post("/admin/manager-assistant/questions/:questionId/resolve", async (req, res): Promise<void> => {
  const parsed = uuid.safeParse(param(req.params.questionId));
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid question id." });
    return;
  }
  const resolved = await questions.resolve(parsed.data);
  if (!resolved) {
    res.status(409).json({ error: "Question is already resolved or unavailable." });
    return;
  }
  res.json({ ok: true });
});

const promoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(12000),
  scope: z.enum(["global", "package", "resource", "site", "leg"]),
  scopeRecordId: z.string().trim().max(200).nullable().optional(),
  effectiveAt: z.coerce.date().optional(),
  reviewAfter: z.coerce.date().nullable().optional(),
});

router.post("/admin/manager-assistant/questions/:questionId/promote", async (req, res): Promise<void> => {
  const questionId = uuid.safeParse(param(req.params.questionId));
  const parsed = promoteSchema.safeParse(req.body);
  if (!questionId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid question id." : parsed.error.issues[0]?.message ?? "Invalid knowledge entry." });
    return;
  }
  const question = await questions.getById(questionId.data);
  if (!question) {
    res.status(404).json({ error: "Admin question not found." });
    return;
  }
  const entry = await knowledge.create({
    title: parsed.data.title,
    body: parsed.data.body,
    scope: parsed.data.scope,
    scopeRecordId:
      parsed.data.scope === "leg"
        ? parsed.data.scopeRecordId ?? question.travelLegId
        : parsed.data.scopeRecordId ?? null,
    sourceAdminQuestionId: question.id,
    effectiveAt: parsed.data.effectiveAt ?? new Date(),
    reviewAfter: parsed.data.reviewAfter ?? null,
    createdBy: (req as any).userId ?? "owner",
  });
  res.status(201).json({ entry });
});

export default router;
