import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";

import type { DraftGenerator, GeneratedOpportunityDraft } from "./draft-generator";
import { ADVENTURE_ZONE_EMAIL_RULES } from "./draft-guardrails";
import type { DraftContext } from "./draft-context-resolver";
import type {
  DraftRewriteAction,
  DraftRewriteAdapter,
} from "./opportunity-email-service";
import type { OpportunityDraftPurpose } from "./opportunity-email-types";

function invalidOutput(): Error {
  return Object.assign(new Error("OPPORTUNITY_EMAIL_AI_OUTPUT_INVALID"), {
    code: "OPPORTUNITY_EMAIL_AI_OUTPUT_INVALID",
  });
}

function parseDraft(text: string): GeneratedOpportunityDraft {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw invalidOutput();
    try {
      value = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw invalidOutput();
    }
  }
  if (!value || typeof value !== "object") throw invalidOutput();
  const row = value as Record<string, unknown>;
  const subject = typeof row.subject === "string" ? row.subject.trim() : "";
  const body = typeof row.body === "string" ? row.body.trim() : "";
  if (!subject || !body) throw invalidOutput();
  return { subject, body };
}

function evidence(context: DraftContext): string {
  return JSON.stringify({
    event: {
      name: context.eventName,
      city: context.city,
      region: context.region,
      startsAt: context.startsAt?.toISOString() ?? null,
      endsAt: context.endsAt?.toISOString() ?? null,
      year: context.eventYear,
    },
    recipient: {
      name: context.recipientName,
      email: context.recipientEmail,
    },
    relationshipHistory: context.priorRelationshipSummary,
    calendarEvidence: context.calendarEvidence,
    packageAvailability: context.packageAvailability,
  });
}

function generationPrompt(context: DraftContext, purpose: OpportunityDraftPurpose): string {
  return [
    "Write one plain-text Adventure Zone booking email from the supplied evidence only.",
    'Return exactly one JSON object: {"subject":"...","body":"..."}. No markdown.',
    `Purpose: ${purpose}`,
    "Rules:",
    "- Never invent prior interactions, names, dates, availability, event facts, or contact history.",
    "- If relationship history shows prior contact, write as a continuation; do not use a cold introduction.",
    "- Mention all three normal packages when appropriate, even if one is unavailable; explicitly note a verified conflicting date for any fully unavailable package.",
    `- Adventure Zone: ${ADVENTURE_ZONE_EMAIL_RULES.pricing.adventureZone}.`,
    `- Pirate’s Rebellion: ${ADVENTURE_ZONE_EMAIL_RULES.pricing.piratesRebellion}.`,
    `- Warrior’s Playground: ${ADVENTURE_ZONE_EMAIL_RULES.pricing.warriorsPlayground}.`,
    `- Insurance: ${ADVENTURE_ZONE_EMAIL_RULES.insurance}.`,
    `- Approved pay-for-play wording, when relevant, must be exactly: ${ADVENTURE_ZONE_EMAIL_RULES.payForPlay}`,
    "- Do not promise revenue, attendance, or minimum sales. Do not use guarantee language or 'no guarantee' language.",
    "- Do not imply Adventure Zone buys sponsorship. Prefer entertainment partnership, event partnership, separate staffed attraction area, or family-entertainment area.",
    "- Adult-only or 21+ is not automatically a rejection; only mention an adult configuration if the evidence supports it.",
    "- Keep the tone natural, useful, and concise.",
    "Evidence:",
    evidence(context),
  ].join("\n");
}

function rewritePrompt(input: {
  purpose: OpportunityDraftPurpose;
  action: DraftRewriteAction;
  subject: string;
  body: string;
}): string {
  return [
    "Rewrite the current Adventure Zone email according to exactly one requested action.",
    'Return exactly one JSON object: {"subject":"...","body":"..."}. No markdown.',
    `Purpose: ${input.purpose}`,
    `Action: ${input.action}`,
    "Do not add new facts, interactions, names, dates, prices, availability claims, promises, or commercial terms.",
    "Preserve factual meaning and any exact approved wording already present.",
    `Current subject: ${input.subject}`,
    "Current body:",
    input.body,
  ].join("\n");
}

export class AiOpportunityEmailWriter implements DraftGenerator, DraftRewriteAdapter {
  constructor(private readonly ai: AiCompletionClient) {}

  async generate(input: {
    context: DraftContext;
    purpose: OpportunityDraftPurpose;
    existingBody?: string | null;
  }): Promise<GeneratedOpportunityDraft> {
    return parseDraft(await this.ai.complete(generationPrompt(input.context, input.purpose)));
  }

  async rewrite(input: {
    opportunityId: string;
    draftId: string;
    purpose: OpportunityDraftPurpose;
    action: DraftRewriteAction;
    subject: string;
    body: string;
  }): Promise<GeneratedOpportunityDraft> {
    return parseDraft(await this.ai.complete(rewritePrompt(input)));
  }
}
