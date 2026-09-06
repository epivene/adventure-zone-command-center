import { z } from "zod";
import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import {
  normalizeFamilyName,
  type EventFamilyCandidate,
  type EventFamilyProposal,
} from "./event-family-classifier";

const rawProposalSchema = z.object({
  proposedName: z.string().trim().min(1).max(160),
  candidateIds: z.array(z.string()).min(2),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(500),
});

const rawProposalListSchema = z.array(rawProposalSchema).max(100);

function stripSingleFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function buildPrompt(candidates: readonly EventFamilyCandidate[]): string {
  const safeCandidates = candidates.map(({ id, name, placeType, city, region }) => ({
    id,
    name,
    placeType,
    city,
    region,
  }));

  return [
    "Group only profiles that clearly describe the same recurring event family or holiday event type.",
    "Do not infer from contact information, notes, call history, bookings, follow-ups, or any other CRM data; none is provided.",
    "Return JSON only, with no prose or markdown:",
    '[{"proposedName":"Fourth of July","candidateIds":["uuid-1","uuid-2"],"confidence":0.94,"reason":"Names describe the same recurring holiday event type"}]',
    "Rules: every group needs at least two distinct submitted IDs; do not reuse an ID in multiple groups; confidence must be between 0 and 1; omit uncertain groups.",
    `Candidates: ${JSON.stringify(safeCandidates)}`,
  ].join("\n");
}

export async function suggestEventFamiliesWithAi(
  client: AiCompletionClient,
  candidates: readonly EventFamilyCandidate[],
): Promise<EventFamilyProposal[]> {
  if (candidates.length < 2) return [];

  const allowedIds = new Set(candidates.map((candidate) => candidate.id));
  let parsed: z.infer<typeof rawProposalListSchema>;
  try {
    const raw = await client.complete(buildPrompt(candidates));
    parsed = rawProposalListSchema.parse(JSON.parse(stripSingleFence(raw)));
  } catch {
    return [];
  }

  type AiEventFamilyProposal = EventFamilyProposal & { source: "ai" };

  const normalized = parsed
    .map((proposal): AiEventFamilyProposal | null => {
      const ids = [...new Set(proposal.candidateIds)].sort((a, b) => a.localeCompare(b, "en-US"));
      if (ids.length < 2 || ids.some((id) => !allowedIds.has(id))) return null;
      return {
        proposedName: proposal.proposedName,
        normalizedName: normalizeFamilyName(proposal.proposedName),
        candidateIds: ids,
        source: "ai",
        confidence: proposal.confidence,
        reason: proposal.reason,
      };
    })
    .filter((proposal): proposal is AiEventFamilyProposal => proposal !== null)
    .sort((a, b) => b.confidence - a.confidence);

  const claimed = new Set<string>();
  const result: EventFamilyProposal[] = [];
  for (const proposal of normalized) {
    if (proposal.candidateIds.some((id) => claimed.has(id))) continue;
    result.push(proposal);
    proposal.candidateIds.forEach((id) => claimed.add(id));
  }
  return result;
}

export const eventFamilyAiInternals = { buildPrompt, stripSingleFence };
