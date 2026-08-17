import { createHash } from "node:crypto";

import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";

export const derivedFactKindValues = [
  "recurring_event_timing",
  "usual_package",
  "usual_attraction_count",
  "contact_preference",
  "decision_maker",
  "objection",
  "promised_follow_up",
  "prior_outcome",
  "special_requirement",
] as const;

export type DerivedFactKind = (typeof derivedFactKindValues)[number];

export type DerivedFactSourceActivity = {
  id: string;
  body: string;
  occurredAt: string | null;
  sourceRecordId: string | null;
  sourceVersionId: string | null;
};

export type DerivedFactCandidate = {
  factKind: DerivedFactKind;
  summary: string;
  value: unknown;
  confidence: "high" | "medium" | "low";
  sourceActivityId: string;
  sourceRecordId: string | null;
  sourceVersionId: string | null;
  extractionFingerprint: string;
};

function confidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "low";
}

function isDerivedFactKind(value: unknown): value is DerivedFactKind {
  return (
    typeof value === "string" &&
    (derivedFactKindValues as readonly string[]).includes(value)
  );
}

function normalizedValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

function fingerprint(input: {
  sourceActivityId: string;
  sourceVersionId: string | null;
  factKind: DerivedFactKind;
  value: unknown;
  summary: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.sourceActivityId,
        input.sourceVersionId ?? "no-version",
        input.factKind,
        normalizedValue(input.value),
        input.summary.trim().toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
}

export function parseDerivedFactCandidates(
  raw: string,
  activities: readonly DerivedFactSourceActivity[],
): DerivedFactCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const facts = (parsed as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return [];
  const sourceById = new Map(activities.map((activity) => [activity.id, activity]));

  return facts.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if (!isDerivedFactKind(row.factKind)) return [];
    if (typeof row.sourceActivityId !== "string") return [];
    const source = sourceById.get(row.sourceActivityId);
    if (!source) return [];
    if (typeof row.summary !== "string" || !row.summary.trim()) return [];
    const factKind = row.factKind;
    const summary = row.summary.trim().slice(0, 500);
    const value = row.value ?? null;
    return [
      {
        factKind,
        summary,
        value,
        confidence: confidence(row.confidence),
        sourceActivityId: source.id,
        sourceRecordId: source.sourceRecordId,
        sourceVersionId: source.sourceVersionId,
        extractionFingerprint: fingerprint({
          sourceActivityId: source.id,
          sourceVersionId: source.sourceVersionId,
          factKind,
          value,
          summary,
        }),
      },
    ];
  });
}

export function buildDerivedFactPrompt(input: {
  organizationId?: string;
  contactId?: string;
  activities: readonly DerivedFactSourceActivity[];
}): string {
  return [
    "Extract only explicit or strongly supported CRM facts from the supplied Adventure Zone activity history.",
    `Allowed fact kinds: ${derivedFactKindValues.join(", ")}.`,
    "Do not infer package history or attraction counts when those should come from structured booking records.",
    "Do not invent dates, people, decisions, objections, promises, preferences, or requirements.",
    "Every fact must cite exactly one sourceActivityId from the input.",
    "Return ONLY JSON: {\"facts\":[{\"factKind\":string,\"summary\":string,\"value\":object|string|number|boolean|null,\"confidence\":\"high\"|\"medium\"|\"low\",\"sourceActivityId\":string}]}",
    "",
    `ORGANIZATION ID: ${input.organizationId ?? "none"}`,
    `CONTACT ID: ${input.contactId ?? "none"}`,
    `ACTIVITIES: ${JSON.stringify(input.activities)}`,
  ].join("\n");
}

export interface DerivedFactExtractor {
  extract(input: {
    organizationId?: string;
    contactId?: string;
    activities: DerivedFactSourceActivity[];
  }): Promise<DerivedFactCandidate[]>;
}

export class AiDerivedFactExtractor implements DerivedFactExtractor {
  constructor(private readonly client: AiCompletionClient) {}

  async extract(input: {
    organizationId?: string;
    contactId?: string;
    activities: DerivedFactSourceActivity[];
  }): Promise<DerivedFactCandidate[]> {
    if (input.activities.length === 0) return [];
    const raw = await this.client.complete(buildDerivedFactPrompt(input));
    return parseDerivedFactCandidates(raw, input.activities);
  }
}
