import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";

import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { AdminQuestionService } from "@/features/manager-assistant/admin-question-service";
import { PostgresAdminQuestionRepository } from "@/features/manager-assistant/admin-question-repository";
import { ManagerAssistantService } from "@/features/manager-assistant/manager-assistant-service";
import {
  managerAskInputSchema,
  managerContextInputSchema,
} from "@/features/manager-assistant/manager-assistant-input";
import { PostgresManagerAssistantContextSource } from "@/features/manager-assistant/manager-assistant-context-repository";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const source = new PostgresManagerAssistantContextSource();
const assistant = new ManagerAssistantService(source);
const questionRepo = new PostgresAdminQuestionRepository();
const questions = new AdminQuestionService({ source, store: questionRepo });

const askAdminSchema = managerAskInputSchema.extend({
  clientMutationId: z.string().uuid(),
  urgency: z.enum(["normal", "urgent"]).default("normal"),
  escalationReason: z.string().trim().min(1).max(1000),
});
const responseSchema = z.object({ body: z.string().trim().min(1).max(12000) }).strict();

router.get("/manager/assistant/context", requireManager, async (req, res): Promise<void> => {
  const parsed = managerContextInputSchema.safeParse({
    contextKind: req.query.kind,
    contextRecordId: req.query.id,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid manager assistant context." });
    return;
  }
  const context = await assistant.getContext({
    authenticatedLegId: req.legManager!.legId,
    request: parsed.data,
  });
  if (!context) {
    res.status(403).json({ error: "That record is outside your assigned leg." });
    return;
  }
  res.json({ context });
});

router.post("/manager/assistant/ask", requireManager, async (req, res): Promise<void> => {
  const parsed = managerAskInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid manager assistant question." });
    return;
  }
  const result = await assistant.ask({
    authenticatedLegId: req.legManager!.legId,
    request: parsed.data,
  });
  if (!result) {
    res.status(403).json({ error: "That record is outside your assigned leg." });
    return;
  }
  res.json(result);
});

router.post("/manager/assistant/admin-questions", requireManager, async (req, res): Promise<void> => {
  const parsed = askAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid admin question." });
    return;
  }
  const result = await questions.create({
    authenticatedLegId: req.legManager!.legId,
    managerSessionSubject: `manager:${req.legManager!.legId}`,
    contextKind: parsed.data.contextKind,
    contextRecordId: parsed.data.contextRecordId,
    clientMutationId: parsed.data.clientMutationId,
    question: parsed.data.question,
    urgency: parsed.data.urgency,
    escalationReason: parsed.data.escalationReason,
  });
  if (!result.ok) {
    res.status(403).json({ error: "That record is outside your assigned leg." });
    return;
  }
  res.status(result.question.idempotent ? 200 : 201).json({ question: result.question });
});

router.get("/manager/assistant/admin-questions", requireManager, async (req, res) => {
  res.json({ questions: await questionRepo.listForLeg(req.legManager!.legId) });
});

router.post("/manager/assistant/admin-questions/:questionId/respond", requireManager, async (req, res): Promise<void> => {
  const questionId = z.string().uuid().safeParse(Array.isArray(req.params.questionId) ? req.params.questionId[0] : req.params.questionId);
  const parsed = responseSchema.safeParse(req.body);
  if (!questionId.success || !parsed.success) {
    res.status(400).json({ error: "Enter a response." });
    return;
  }
  const question = await questionRepo.getById(questionId.data);
  if (!question || question.travelLegId !== req.legManager!.legId) {
    res.status(404).json({ error: "Admin question not found." });
    return;
  }
  if (question.status === "resolved") {
    res.status(409).json({ error: "This question is already resolved." });
    return;
  }
  const response = await questionRepo.addResponse({
    questionId: question.id,
    actorType: "manager",
    actorId: `manager:${req.legManager!.legId}`,
    body: parsed.data.body,
  });
  res.status(201).json({ response });
});

export default router;
