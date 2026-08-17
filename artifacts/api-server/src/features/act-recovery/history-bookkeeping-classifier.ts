export const ACT_HISTORY_PURGE_POLICY_VERSION = "2026-08-16-v1";

export type ActHistoryPurgeReason =
  | "relationship_bookkeeping"
  | "record_lifecycle_bookkeeping"
  | "field_change_bookkeeping";

export type ActHistoryPurgeDecision =
  | { purge: true; reason: ActHistoryPurgeReason }
  | { purge: false };

const relationshipPatterns = [
  /^linked to (company|contact|opportunity)\b.+$/i,
  /^(company|contact|opportunity)\b.+\blinked$/i,
  /^unlinked from (company|contact|opportunity)\b.*$/i,
];

const lifecyclePatterns = [
  /^record (created|updated)$/i,
  /^(contact|company|opportunity|history|note) (created|updated)$/i,
];

const fieldChangePatterns = [
  /^(?:field\s+)?[\w .-]+ (?:field )?(?:changed|updated)(?: from .+ to .+)?$/i,
];

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function classifyWholeText(value: string): ActHistoryPurgeDecision {
  if (!value) return { purge: false };
  if (relationshipPatterns.some((pattern) => pattern.test(value))) {
    return { purge: true, reason: "relationship_bookkeeping" };
  }
  if (lifecyclePatterns.some((pattern) => pattern.test(value))) {
    return { purge: true, reason: "record_lifecycle_bookkeeping" };
  }
  if (fieldChangePatterns.some((pattern) => pattern.test(value))) {
    return { purge: true, reason: "field_change_bookkeeping" };
  }
  return { purge: false };
}

export function classifyActHistoryForPurge(input: {
  subject: string | null;
  body: string;
}): ActHistoryPurgeDecision {
  const subject = normalize(input.subject);
  const body = normalize(input.body);

  if (subject && body) {
    const bodyDecision = classifyWholeText(body);
    if (!bodyDecision.purge) return { purge: false };
    const subjectDecision = classifyWholeText(subject);
    return subjectDecision.purge || subject.toLowerCase() === body.toLowerCase()
      ? bodyDecision
      : { purge: false };
  }

  return classifyWholeText(body || subject);
}
