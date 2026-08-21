import { Router, type IRouter } from "express";
import { z } from "zod";

import { GeneralConversationService } from "@/features/assistant/general-conversation-service";

const router: IRouter = Router();
const service = new GeneralConversationService();
const questionSchema = z.object({ question: z.string().trim().min(1).max(4000) }).strict();
const conversationIdSchema = z.uuid();

function actorId(req: unknown): string {
  return String((req as { userId?: unknown }).userId ?? "");
}

router.post("/assistant/general/conversations", async (req, res): Promise<void> => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review your assistant question." });
    return;
  }
  try {
    const result = await service.ask({ actorId: actorId(req), question: parsed.data.question });
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Could not start general assistant conversation");
    res.status(500).json({ error: "Could not start the assistant conversation." });
  }
});

router.get("/assistant/general/conversations/:conversationId", async (req, res): Promise<void> => {
  const parsed = conversationIdSchema.safeParse(req.params.conversationId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid assistant conversation." });
    return;
  }
  try {
    const conversation = await service.get({ actorId: actorId(req), conversationId: parsed.data });
    if (!conversation) {
      res.status(404).json({ error: "Assistant conversation not found." });
      return;
    }
    res.json({ conversation });
  } catch (err) {
    req.log.error({ err }, "Could not load general assistant conversation");
    res.status(500).json({ error: "Could not load the assistant conversation." });
  }
});

router.post("/assistant/general/conversations/:conversationId/ask", async (req, res): Promise<void> => {
  const conversationId = conversationIdSchema.safeParse(req.params.conversationId);
  const question = questionSchema.safeParse(req.body);
  if (!conversationId.success || !question.success) {
    res.status(400).json({ error: "Review the assistant conversation and question." });
    return;
  }
  try {
    const result = await service.ask({
      actorId: actorId(req),
      conversationId: conversationId.data,
      question: question.data.question,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "ASSISTANT_CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "Assistant conversation not found." });
      return;
    }
    req.log.error({ err }, "Could not continue general assistant conversation");
    res.status(500).json({ error: "Could not continue the assistant conversation." });
  }
});

export default router;
