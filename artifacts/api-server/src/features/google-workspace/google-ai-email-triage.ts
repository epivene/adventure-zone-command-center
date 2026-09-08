import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";

export type GoogleAiEmailTriageResult = {
  outcome: "match" | "ignore" | "review";
  profileId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  providerName: string;
};

type CandidateProfile = { id: string; name: string };

type ParsedDecision = {
  decision: "MATCH" | "IGNORE" | "REVIEW";
  profileId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const MAX_BODY_CHARS = 18_000;
const MAX_REASON_CHARS = 500;
const MAX_CANDIDATES = 12;

function jsonObject(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parsedDecision(value: unknown): ParsedDecision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.decision !== "MATCH" && row.decision !== "IGNORE" && row.decision !== "REVIEW") {
    return null;
  }
  if (row.confidence !== "high" && row.confidence !== "medium" && row.confidence !== "low") {
    return null;
  }
  const profileId = row.profileId === null || typeof row.profileId === "undefined"
    ? null
    : typeof row.profileId === "string"
      ? row.profileId.trim() || null
      : null;
  const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, MAX_REASON_CHARS) : "";
  if (!reason) return null;
  return {
    decision: row.decision,
    profileId,
    confidence: row.confidence,
    reason,
  };
}

function promptFor(input: {
  subject: string;
  from: string;
  to: string;
  labels: string[];
  bodyText: string;
  deterministicEvidence: string[];
  matchedContactName: string | null;
  candidateProfiles: CandidateProfile[];
}): string {
  const candidates = input.candidateProfiles.slice(0, MAX_CANDIDATES);
  return [
    "You classify one Gmail conversation for The Adventure Zone CRM.",
    "Return exactly one JSON object and no markdown:",
    '{"decision":"MATCH|IGNORE|REVIEW","profileId":"candidate-id-or-null","confidence":"high|medium|low","reason":"short evidence-based reason"}',
    "",
    "Rules:",
    "- MATCH only to one of the candidate profile IDs listed below. Never invent a profile ID.",
    "- Use MATCH only when the email content clearly identifies that event/profile by name, city/state, venue, dates, organizer, or other strong contextual evidence.",
    "- Contact relationships are hints, not authority. A contact's saved active profile must never override a different event named or clearly described in the email.",
    "- IGNORE when the message is personal, shopping/promotional, account/admin, financial/payment/receipt, or general owner mail with no meaningful link to a show, event, CRM profile, contact, booking, package, venue, association, employee-business matter, or Adventure Zone operations.",
    "- A payment/receipt is relevant only when the email itself connects it to a candidate event/profile or other clear Adventure Zone CRM context.",
    "- If the email is clearly Adventure Zone business but no supplied candidate is safe, choose REVIEW.",
    "- If multiple supplied candidates remain plausible, choose REVIEW.",
    "- High confidence is required for automatic MATCH or IGNORE. Use medium/low whenever important evidence is missing or conflicting.",
    "",
    `Subject: ${input.subject}`,
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Gmail labels: ${input.labels.join(", ") || "none"}`,
    `Deterministic evidence: ${input.deterministicEvidence.join(", ") || "none"}`,
    `Matched CRM contact (hint only): ${input.matchedContactName ?? "none"}`,
    "Candidate profiles:",
    candidates.length
      ? candidates.map((candidate) => `- ${candidate.id}: ${candidate.name}`).join("\n")
      : "- none supplied; MATCH is not allowed",
    "",
    "Readable email/thread content:",
    input.bodyText.slice(0, MAX_BODY_CHARS),
  ].join("\n");
}

export async function triageGoogleEmailWithAi(input: {
  ai: AiCompletionClient;
  subject: string;
  from: string;
  to: string;
  labels: string[];
  bodyText: string;
  deterministicEvidence: string[];
  matchedContactName: string | null;
  candidateProfiles: CandidateProfile[];
  timeoutMs?: number;
}): Promise<GoogleAiEmailTriageResult> {
  const providerName = input.ai.providerName;
  try {
    const raw = await withGoogleTimeout(
      input.ai.complete(promptFor(input)),
      input.timeoutMs ?? 15_000,
    );
    const parsed = parsedDecision(jsonObject(raw));
    if (!parsed) {
      return {
        outcome: "review",
        profileId: null,
        confidence: "low",
        reason: "AI returned invalid structured output; manual review retained.",
        providerName,
      };
    }

    const allowedIds = new Set(input.candidateProfiles.slice(0, MAX_CANDIDATES).map((profile) => profile.id));
    if (parsed.decision === "MATCH") {
      if (parsed.confidence !== "high" || !parsed.profileId || !allowedIds.has(parsed.profileId)) {
        return {
          outcome: "review",
          profileId: null,
          confidence: parsed.confidence,
          reason: !parsed.profileId || !allowedIds.has(parsed.profileId)
            ? "AI proposed a profile outside the supplied candidate list; manual review retained."
            : parsed.reason,
          providerName,
        };
      }
      return {
        outcome: "match",
        profileId: parsed.profileId,
        confidence: "high",
        reason: parsed.reason,
        providerName,
      };
    }

    if (parsed.decision === "IGNORE") {
      if (parsed.confidence !== "high") {
        return {
          outcome: "review",
          profileId: null,
          confidence: parsed.confidence,
          reason: parsed.reason,
          providerName,
        };
      }
      return {
        outcome: "ignore",
        profileId: null,
        confidence: "high",
        reason: parsed.reason,
        providerName,
      };
    }

    return {
      outcome: "review",
      profileId: null,
      confidence: parsed.confidence,
      reason: parsed.reason,
      providerName,
    };
  } catch {
    return {
      outcome: "review",
      profileId: null,
      confidence: "low",
      reason: "AI triage was unavailable; manual review retained.",
      providerName,
    };
  }
}
import { withGoogleTimeout } from "./google-async-timeout";
