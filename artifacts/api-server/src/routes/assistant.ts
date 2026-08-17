import { Router, type IRouter } from "express";

import {
  askBookingAssistantInputSchema,
  getAssistantContextInputSchema,
} from "@/features/assistant/assistant-input";
import { AssistantConversationRepository } from "@/features/assistant/assistant-conversation-repository";
import { AssistantService } from "@/features/assistant/assistant-service";
import { BookingContextRepository } from "@/features/assistant/booking-context-repository";
import { ProfileContextRepository } from "@/features/assistant/profile-context-repository";
import type {
  AssistantContextKind,
  BookingAssistantContextBundle,
} from "@/features/assistant/assistant-types";

const router: IRouter = Router();

async function loadContext(input: {
  contextKind: AssistantContextKind;
  contextRecordId: string;
}): Promise<BookingAssistantContextBundle | null> {
  switch (input.contextKind) {
    case "booking":
      return new BookingContextRepository().getBookingContext(input.contextRecordId);
    case "organization":
      return new ProfileContextRepository().getOrganizationContext(
        input.contextRecordId,
      );
    case "event_family":
      return new ProfileContextRepository().getEventFamilyContext(
        input.contextRecordId,
      );
    default:
      return null;
  }
}

function service(): AssistantService {
  return new AssistantService({ loadContext });
}

router.get("/assistant/context", async (req, res): Promise<void> => {
  const parsed = getAssistantContextInputSchema.safeParse({
    contextKind: req.query.kind,
    contextRecordId: req.query.id,
  });
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Review the assistant context.",
    });
    return;
  }
  try {
    const context = await service().getContext(parsed.data);
    if (!context) {
      res.status(404).json({ error: "Assistant context not found." });
      return;
    }
    res.json({ context });
  } catch (err) {
    req.log.error({ err }, "Failed to load assistant context");
    res.status(500).json({ error: "Could not load assistant context." });
  }
});

router.get("/assistant/brief", async (req, res): Promise<void> => {
  const parsed = getAssistantContextInputSchema.safeParse({
    contextKind: req.query.kind,
    contextRecordId: req.query.id,
  });
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Review the assistant context.",
    });
    return;
  }
  try {
    const brief = await service().getBrief(parsed.data);
    if (!brief) {
      res.status(404).json({ error: "Assistant context not found." });
      return;
    }
    res.json({ brief });
  } catch (err) {
    req.log.error({ err }, "Failed to load booking brief");
    res.status(500).json({ error: "Could not load booking brief." });
  }
});

router.get("/assistant/conversation", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  const parsed = getAssistantContextInputSchema.safeParse({
    contextKind: req.query.kind,
    contextRecordId: req.query.id,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Review the assistant context." });
    return;
  }
  try {
    const conversation = await new AssistantConversationRepository()
      .getLatestConversation({ actorId, ...parsed.data });
    res.json({ conversation });
  } catch (err) {
    req.log.error({ err }, "Failed to resume assistant conversation");
    res.status(500).json({ error: "Could not load the assistant conversation." });
  }
});

router.post("/assistant/ask", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  const parsed = askBookingAssistantInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Review your assistant question.",
    });
    return;
  }
  try {
    const result = await service().ask(parsed.data);
    const conversations = new AssistantConversationRepository();
    const conversationId = await conversations.ensureConversation({
      conversationId: parsed.data.conversationId,
      actorId,
      contextKind: parsed.data.contextKind,
      contextRecordId: parsed.data.contextRecordId,
      firstQuestion: parsed.data.question,
    });
    await conversations.appendExchange({
      conversationId,
      actorId,
      question: parsed.data.question,
      answer: result.answer,
    });
    res.json({ ...result, conversationId });
  } catch (err) {
    if (err instanceof Error && err.message === "ASSISTANT_CONTEXT_NOT_FOUND") {
      res.status(404).json({ error: "Assistant context not found." });
      return;
    }
    if (
      err instanceof Error &&
      err.message === "ASSISTANT_CONVERSATION_NOT_FOUND"
    ) {
      res.status(404).json({ error: "Assistant conversation not found." });
      return;
    }
    req.log.error({ err }, "Booking Assistant ask failed");
    res.status(500).json({
      error: "The Booking Assistant could not answer that right now.",
    });
  }
});

export default router;
