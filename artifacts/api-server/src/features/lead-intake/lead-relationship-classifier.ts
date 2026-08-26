export type LeadRelationshipEvidence = {
  evidenceId: string;
  sourceType: "act" | "gmail" | "crm";
  sourceId: string;
  occurredAt: Date;
  direction: "inbound" | "outbound" | "unknown";
  responseProven: boolean;
  organizationId: string;
  contactId: string | null;
  recipientEmail: string | null;
  excerpt: string;
  conflicting: boolean;
};

export type LeadRelationshipOutcome =
  | "returning_contact"
  | "reintroduction"
  | "prior_outreach_no_response"
  | "new_introduction"
  | "needs_review";

type Result = {
  outcome: LeadRelationshipOutcome;
  cutoffDate: string;
  evidenceIds: string[];
  latestOutboundAt: Date | null;
  latestVerifiedResponseAt: Date | null;
  reviewRequired: boolean;
};

function normalizedEmail(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function cutoff(anchor: Date) {
  if (Number.isNaN(anchor.valueOf())) throw new RangeError("Relationship classification requires a valid anchor date.");
  const year = anchor.getUTCFullYear() - 3;
  const month = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(anchor.getUTCDate(), lastDay);
  const date = new Date(Date.UTC(year, month, day));
  return { date, text: date.toISOString().slice(0, 10) };
}

function materialFingerprint(item: LeadRelationshipEvidence) {
  return JSON.stringify({
    occurredAt: Number.isFinite(item.occurredAt.valueOf()) ? item.occurredAt.toISOString() : "invalid",
    direction: item.direction,
    responseProven: item.responseProven,
    organizationId: item.organizationId,
    contactId: item.contactId,
    recipientEmail: normalizedEmail(item.recipientEmail),
    conflicting: item.conflicting,
  });
}

function newest(items: LeadRelationshipEvidence[]) {
  return items.reduce<Date | null>((latest, item) => {
    if (!Number.isFinite(item.occurredAt.valueOf())) return latest;
    if (!latest || item.occurredAt > latest) return item.occurredAt;
    return latest;
  }, null);
}

export function classifyLeadRelationship(input: {
  organizationId: string;
  recipientEmail: string;
  anchor: Date;
  evidence: LeadRelationshipEvidence[];
}): Result {
  const cutoffValue = cutoff(input.anchor);
  const groups = new Map<string, LeadRelationshipEvidence[]>();
  for (const item of input.evidence) {
    const key = `${item.sourceType}:${item.sourceId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  let duplicatesDisagree = false;
  const unique = [...groups.values()].map((items) => {
    const ordered = [...items].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
    const fingerprints = new Set(ordered.map(materialFingerprint));
    if (fingerprints.size > 1) duplicatesDisagree = true;
    return ordered[0];
  });
  const evidenceIds = unique.map((item) => item.evidenceId).sort();
  const recipient = normalizedEmail(input.recipientEmail);

  const unsafe = duplicatesDisagree || !input.organizationId.trim() || !recipient || unique.some((item) =>
    Number.isNaN(item.occurredAt.valueOf())
    || item.occurredAt > input.anchor
    || item.conflicting
    || item.organizationId !== input.organizationId
    || normalizedEmail(item.recipientEmail) !== recipient
    || item.direction === "unknown"
    || (item.sourceType === "crm" && (item.direction !== "unknown" || item.responseProven))
    || (item.direction === "inbound" && !item.responseProven)
    || (item.direction !== "inbound" && item.responseProven)
  );

  const responses = unique.filter((item) => item.direction === "inbound" && item.responseProven);
  const outbound = unique.filter((item) => item.direction === "outbound" && !item.responseProven);
  const latestVerifiedResponseAt = newest(responses);
  const latestOutboundAt = newest(outbound);

  if (unsafe) {
    return {
      outcome: "needs_review",
      cutoffDate: cutoffValue.text,
      evidenceIds,
      latestOutboundAt,
      latestVerifiedResponseAt,
      reviewRequired: true,
    };
  }
  if (latestVerifiedResponseAt) {
    return {
      outcome: latestVerifiedResponseAt >= cutoffValue.date ? "returning_contact" : "reintroduction",
      cutoffDate: cutoffValue.text,
      evidenceIds,
      latestOutboundAt,
      latestVerifiedResponseAt,
      reviewRequired: false,
    };
  }
  return {
    outcome: latestOutboundAt ? "prior_outreach_no_response" : "new_introduction",
    cutoffDate: cutoffValue.text,
    evidenceIds,
    latestOutboundAt,
    latestVerifiedResponseAt: null,
    reviewRequired: false,
  };
}
