import { Router, type IRouter } from "express";
import { z } from "zod";

import {
  askBookingAssistantInputSchema,
  getAssistantContextInputSchema,
} from "@/features/assistant/assistant-input";
import { AssistantConversationRepository } from "@/features/assistant/assistant-conversation-repository";
import { AssistantService } from "@/features/assistant/assistant-service";
import { BookingContextRepository } from "@/features/assistant/booking-context-repository";
import { ContactContextRepository } from "@/features/assistant/contact-context-repository";
import { extractDerivedFactsForProfile } from "@/features/assistant/derived-fact-job";
import { DerivedFactRepository } from "@/features/assistant/derived-fact-repository";
import { answerGeneralAssistant, isLeadDiscoveryQuestion } from "@/features/assistant/general-assistant";
import { LeadScoutService } from "@/features/assistant/lead-scout-service";
import { profileSearchInputSchema } from "@/features/assistant/profile-search-input";
import { PostgresProfileSearchRepository } from "@/features/assistant/profile-search-repository";
import { ProfileContextRepository } from "@/features/assistant/profile-context-repository";
import { RouteContextRepository } from "@/features/assistant/route-context-repository";
import type {
  AssistantContextKind,
  BookingAssistantContextBundle,
} from "@/features/assistant/assistant-types";

const router: IRouter = Router();
const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());
const profileSearch = new PostgresProfileSearchRepository();
const leadScout = new LeadScoutService();
const allowedProfileSearchKeys = new Set(["q", "city", "region", "packageName", "overdueFollowUp", "limit"]);
const generalAskSchema = z.object({ question: z.string().trim().min(1).max(4000) }).strict();
const factProfileInputSchema = z
  .object({
    organizationId: canonicalUuid.optional(),
    contactId: canonicalUuid.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.organizationId || value.contactId), {
    message: "Choose a profile or contact.",
  });

async function loadContext(input: {
  contextKind: AssistantContextKind;
  contextRecordId: string;
}): Promise<BookingAssistantContextBundle | null> {
  switch (input.contextKind) {
    case "booking":
      return new BookingContextRepository().getBookingContext(input.contextRecordId);
    case "organization":
      return new ProfileContextRepository().getOrganizationContext(input.contextRecordId);
    case "event_family":
      return new ProfileContextRepository().getEventFamilyContext(input.contextRecordId);
    case "contact":
      return new ContactContextRepository().getContactContext(input.contextRecordId);
    case "route":
      return new RouteContextRepository().getRouteContext(input.contextRecordId);
    default:
      return null;
  }
}

function service(): AssistantService {
  return new AssistantService({ loadContext });
}

router.get("/assistant/profile-search", async (req, res): Promise<void> => {
  const unknownKey = Object.keys(req.query).find((key) => !allowedProfileSearchKeys.has(key));
  if (unknownKey) {
    res.status(400).json({ error: `Unsupported profile search field: ${unknownKey}` });
    return;
  }
  const parsed = profileSearchInputSchema.safeParse({
    q: req.query.q,
    city: req.query.city,
    region: req.query.region,
    packageName: req.query.packageName,
    overdueFollowUp: req.query.overdueFollowUp,
    limit: req.query.limit,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the profile search." });
    return;
  }
  try {
    const results = await profileSearch.search({
      query: parsed.data.q,
      city: parsed.data.city,
      region: parsed.data.region,
      packageName: parsed.data.packageName,
      overdueFollowUp: parsed.data.overdueFollowUp,
      limit: parsed.data.limit,
    });
    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "Assistant profile search failed");
    res.status(500).json({ error: "Could not search profiles right now." });
  }
});

router.post("/assistant/general/ask", async (req, res): Promise<void> => {
  const parsed = generalAskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review your assistant question." });
    return;
  }
  try {
    if (isLeadDiscoveryQuestion(parsed.data.question)) {
      const actorId = String((req as any).userId ?? "");
      const discovery = await leadScout.createCrmDiscovery({
        actorId,
        question: parsed.data.question,
      });
      if (!("crmMatches" in discovery)) {
        res.json({
          kind: "lead_discovery_clarification",
          text: discovery.message,
          runId: discovery.runId,
        });
        return;
      }
      res.json({
        kind: "lead_discovery",
        text: discovery.crmMatches.length
          ? `I found ${discovery.crmMatches.length} existing Command Center ${discovery.crmMatches.length === 1 ? "possibility" : "possibilities"}.`
          : "I did not find a strong existing Command Center match for those criteria.",
        run: discovery,
      });
      return;
    }
    res.json(await answerGeneralAssistant({ question: parsed.data.question, profileSearch }));
  } catch (err) {
    req.log.error({ err }, "General Booking Assistant ask failed");
    res.status(500).json({ error: "The Booking Assistant could not search Command Center right now." });
  }
});

router.get("/assistant/context", async (req, res): Promise<void> => {
  const parsed = getAssistantContextInputSchema.safeParse({
    contextKind: req.query.kind,
    contextRecordId: req.query.id,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the assistant context." });
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
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the assistant context." });
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
    const conversation = await new AssistantConversationRepository().getLatestConversation({ actorId, ...parsed.data });
    res.json({ conversation });
  } catch (err) {
    req.log.error({ err }, "Failed to resume assistant conversation");
    res.status(500).json({ error: "Could not load the assistant conversation." });
  }
});

router.post("/assistant/derived-facts/extract", async (req, res): Promise<void> => {
  const parsed = factProfileInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the profile." });
    return;
  }
  try {
    const result = await extractDerivedFactsForProfile(parsed.data);
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Derived fact extraction failed");
    res.status(500).json({ ok: false, error: "Could not analyze imported history right now." });
  }
});

router.get("/assistant/derived-facts", async (req, res): Promise<void> => {
  const parsed = factProfileInputSchema.safeParse({
    organizationId: req.query.organizationId || undefined,
    contactId: req.query.contactId || undefined,
  });
  const status = req.query.status === "proposed" || req.query.status === "confirmed" || req.query.status === "dismissed" ? req.query.status : undefined;
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a profile or contact." });
    return;
  }
  try {
    const facts = await new DerivedFactRepository().listForProfile({ ...parsed.data, status });
    res.json({ facts });
  } catch (err) {
    req.log.error({ err }, "Failed to list derived facts");
    res.status(500).json({ error: "Could not load assistant facts." });
  }
});

router.post("/assistant/derived-facts/:factId/decision", async (req, res): Promise<void> => {
  const factId = canonicalUuid.safeParse(req.params.factId);
  const status = z.enum(["confirmed", "dismissed"]).safeParse(req.body?.status);
  if (!factId.success || !status.success) {
    res.status(400).json({ error: "Review the fact decision." });
    return;
  }
  try {
    const updated = await new DerivedFactRepository().setStatus({ factId: factId.data, status: status.data });
    if (!updated) {
      res.status(409).json({ error: "This fact was already reviewed." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to review derived fact");
    res.status(500).json({ error: "Could not save the assistant fact decision." });
  }
});

router.post("/assistant/ask", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  const parsed = askBookingAssistantInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review your assistant question." });
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
    if (err instanceof Error && err.message === "ASSISTANT_CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "Assistant conversation not found." });
      return;
    }
    req.log.error({ err }, "Booking Assistant ask failed");
    res.status(500).json({ error: "The Booking Assistant could not answer that right now." });
  }
});

export default router;
