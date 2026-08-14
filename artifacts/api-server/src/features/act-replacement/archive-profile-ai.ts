import { z } from "zod";
import { normalizeCompany } from "./normalizers/company-normalizer";
import { normalizeContact } from "./normalizers/contact-normalizer";
import type { AiCompletionClient } from "../ai-suggestions/ai-client";
import type { ArchiveProfileAiProjection } from "./archive-profile-import-types";

export const ARCHIVE_PROFILE_AI_POLICY_VERSION = "archive-profile-ai-v1";

export type ArchiveProfileAiDecision =
  | {
      sourceRecordId: string;
      action: "create_profile";
      confidence: "high" | "medium";
      values: Record<string, string | null>;
      evidenceLabels: string[];
    }
  | {
      sourceRecordId: string;
      action: "preserve_for_later";
      confidence: "high" | "medium" | "low";
      reasonCode: "ai_preserve_requested" | "ai_low_confidence" | "ai_invalid_response";
      evidenceLabels: string[];
    }
  | {
      sourceRecordId: string;
      action: "retry_later";
      reasonCode: "ai_unavailable" | "ai_timeout";
      evidenceLabels: string[];
    };

const MAX_BATCH_SIZE = 20;
const COMPLETION_TIMEOUT_MS = 15_000;
const companyFields = [
  "name",
  "phone",
  "website",
  "industry",
  "address1",
  "address2",
  "city",
  "region",
  "postalCode",
] as const;
const contactFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "address1",
  "address2",
  "city",
  "region",
  "postalCode",
] as const;

const aiDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    sourceRecordId: z.string().min(1),
    action: z.literal("create_profile"),
    confidence: z.enum(["high", "medium", "low"]),
    values: z.record(z.string(), z.string().nullable()),
  }).strict(),
  z.object({
    sourceRecordId: z.string().min(1),
    action: z.literal("preserve_for_later"),
    confidence: z.enum(["high", "medium", "low"]),
  }).strict(),
]);

const aiResponseSchema = z.object({ decisions: z.array(aiDecisionSchema) }).strict();

type AiResponseDecision = z.infer<typeof aiDecisionSchema>;
export type AiCompletionClientFactory = () => Promise<AiCompletionClient>;

export async function resolveArchiveProfilesWithAi(
  client: AiCompletionClient,
  projections: readonly ArchiveProfileAiProjection[],
): Promise<readonly ArchiveProfileAiDecision[]> {
  if (projections.length === 0) return [];

  const prompt = buildArchiveProfileAiPrompt(projections);
  let response: string;
  try {
    response = await completeWithTimeout(client, prompt);
  } catch (error) {
    return retryAll(projections, isTimeout(error) ? "ai_timeout" : "ai_unavailable");
  }
  return parseArchiveProfileAiResponse(response, projections);
}

export async function resolveArchiveProfilesWithAiFactory(
  createClient: AiCompletionClientFactory,
  projections: readonly ArchiveProfileAiProjection[],
): Promise<readonly ArchiveProfileAiDecision[]> {
  if (projections.length === 0) return [];

  let client: AiCompletionClient;
  try {
    client = await createClient();
  } catch (error) {
    return retryAll(projections, isTimeout(error) ? "ai_timeout" : "ai_unavailable");
  }
  return resolveArchiveProfilesWithAi(client, projections);
}

export function buildArchiveProfileAiPrompt(
  projections: readonly ArchiveProfileAiProjection[],
): string {
  if (projections.length > MAX_BATCH_SIZE) throw new Error("ai_batch_too_large");

  const payload = projections.map((projection) => ({
    sourceRecordId: projection.sourceRecordId,
    streamType: projection.streamType,
    supportedFields: safeProjectionValues(projection),
    contextLabels: [...projection.contextLabels],
  }));

  return [
    `Policy: ${ARCHIVE_PROFILE_AI_POLICY_VERSION}`,
    "Return exactly one JSON decision for every supplied sourceRecordId.",
    'Return only {"decisions":[...]}; do not include markdown or explanation.',
    "Each decision may be create_profile or preserve_for_later. create_profile requires high or medium confidence and a values object.",
    "You may only use supplied supportedFields and may not invent or change contact details.",
    "Never select or reference an existing profile, create or change a relationship, delete anything, or use any field outside supportedFields.",
    "When uncertain, use preserve_for_later with low confidence.",
    "Input:",
    JSON.stringify(payload),
  ].join("\n");
}

export function parseArchiveProfileAiResponse(
  text: string,
  projections: readonly ArchiveProfileAiProjection[],
): readonly ArchiveProfileAiDecision[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return preserveAll(projections, "ai_invalid_response");
  }

  const response = aiResponseSchema.safeParse(parsed);
  if (!response.success || !hasExactlyExpectedSourceIds(response.data.decisions, projections)) {
    return preserveAll(projections, "ai_invalid_response");
  }

  const decisionById = new Map(response.data.decisions.map((decision) => [decision.sourceRecordId, decision]));
  const decisions: ArchiveProfileAiDecision[] = [];
  for (const projection of projections) {
    const decision = decisionById.get(projection.sourceRecordId);
    if (!decision) return preserveAll(projections, "ai_invalid_response");

    const safeDecision = validateDecision(decision, projection);
    if (!safeDecision) return preserveAll(projections, "ai_invalid_response");
    decisions.push(safeDecision);
  }
  return decisions;
}

function validateDecision(
  decision: AiResponseDecision,
  projection: ArchiveProfileAiProjection,
): ArchiveProfileAiDecision | null {
  if (decision.action === "preserve_for_later") {
    return preserveDecision(
      projection,
      decision.confidence,
      decision.confidence === "low" ? "ai_low_confidence" : "ai_preserve_requested",
    );
  }

  if (decision.confidence === "low") {
    return preserveDecision(projection, "low", "ai_low_confidence");
  }

  const values = normalizedCreateValues(decision.values, projection);
  if (!values) return null;
  return {
    sourceRecordId: projection.sourceRecordId,
    action: "create_profile",
    confidence: decision.confidence,
    values,
    evidenceLabels: [...projection.contextLabels],
  };
}

function normalizedCreateValues(
  aiValues: Record<string, string | null>,
  projection: ArchiveProfileAiProjection,
): Record<string, string | null> | null {
  const allowedFields = fieldsFor(projection.streamType);
  const projected = safeProjectionValues(projection);
  if (Object.keys(aiValues).some((field) => !allowedFields.includes(field) || !(field in projected))) {
    return null;
  }
  if (Object.entries(aiValues).some(([field, value]) => !sameValue(value, projected[field]!))) {
    return null;
  }

  const normalized = projection.streamType === "company"
    ? normalizeCompany(companyRawValues(aiValues))
    : normalizeContact(contactRawValues(aiValues));
  const normalizedValues = normalized.ok ? normalized.value : normalized.partial;
  if (!hasRequiredIdentity(projection.streamType, normalizedValues)) return null;

  return Object.fromEntries(
    Object.keys(aiValues).map((field) => [
      field,
      stringOrNull((normalizedValues as Record<string, unknown>)[field]),
    ]),
  );
}

function safeProjectionValues(projection: ArchiveProfileAiProjection): Record<string, string | null> {
  const allowed = fieldsFor(projection.streamType);
  return Object.fromEntries(
    Object.keys(projection.supportedFields)
      .filter((field) => allowed.includes(field))
      .map((field) => [field, stringOrNull(projection.supportedFields[field])]),
  );
}

function companyRawValues(values: Record<string, string | null>): Record<string, unknown> {
  return {
    name: values.name,
    phone: values.phone,
    website: values.website,
    industry: values.industry,
    address: addressValues(values),
  };
}

function contactRawValues(values: Record<string, string | null>): Record<string, unknown> {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    emailAddress: values.email,
    phone: values.phone,
    jobTitle: values.jobTitle,
    businessAddress: addressValues(values),
  };
}

function addressValues(values: Record<string, string | null>): Record<string, string | null> {
  return {
    line1: values.address1,
    line2: values.address2,
    city: values.city,
    region: values.region,
    postalCode: values.postalCode,
  };
}

function fieldsFor(streamType: ArchiveProfileAiProjection["streamType"]): readonly string[] {
  return streamType === "company" ? companyFields : contactFields;
}

function hasRequiredIdentity(
  streamType: ArchiveProfileAiProjection["streamType"],
  values: Record<string, unknown>,
): boolean {
  return streamType === "company"
    ? isPresent(values.name)
    : isPresent(values.firstName) && isPresent(values.lastName);
}

function isPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sameValue(left: string | null, right: string | null): boolean {
  return left === right || (typeof left === "string" && typeof right === "string" && left.trim() === right.trim());
}

function hasExactlyExpectedSourceIds(
  decisions: readonly AiResponseDecision[],
  projections: readonly ArchiveProfileAiProjection[],
): boolean {
  if (decisions.length !== projections.length) return false;
  const expected = new Set(projections.map((projection) => projection.sourceRecordId));
  if (expected.size !== projections.length) return false;
  const actual = new Set(decisions.map((decision) => decision.sourceRecordId));
  return actual.size === decisions.length && actual.size === expected.size &&
    [...actual].every((sourceRecordId) => expected.has(sourceRecordId));
}

function preserveAll(
  projections: readonly ArchiveProfileAiProjection[],
  reasonCode: "ai_preserve_requested" | "ai_low_confidence" | "ai_invalid_response",
): readonly ArchiveProfileAiDecision[] {
  return projections.map((projection) => preserveDecision(
    projection,
    reasonCode === "ai_low_confidence" ? "low" : "high",
    reasonCode,
  ));
}

function preserveDecision(
  projection: ArchiveProfileAiProjection,
  confidence: "high" | "medium" | "low",
  reasonCode: "ai_preserve_requested" | "ai_low_confidence" | "ai_invalid_response",
): ArchiveProfileAiDecision {
  return {
    sourceRecordId: projection.sourceRecordId,
    action: "preserve_for_later",
    confidence,
    reasonCode,
    evidenceLabels: [...projection.contextLabels],
  };
}

function retryAll(
  projections: readonly ArchiveProfileAiProjection[],
  reasonCode: "ai_unavailable" | "ai_timeout",
): readonly ArchiveProfileAiDecision[] {
  return projections.map((projection) => ({
    sourceRecordId: projection.sourceRecordId,
    action: "retry_later" as const,
    reasonCode,
    evidenceLabels: [...projection.contextLabels],
  }));
}

function completeWithTimeout(client: AiCompletionClient, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CompletionTimeoutError()), COMPLETION_TIMEOUT_MS);
    Promise.resolve()
      .then(() => client.complete(prompt))
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

class CompletionTimeoutError extends Error {}

function isTimeout(error: unknown): boolean {
  if (error instanceof CompletionTimeoutError) return true;
  if (!error || typeof error !== "object") return false;
  const named = error as { name?: unknown; code?: unknown };
  const name = typeof named.name === "string" ? named.name.toLowerCase() : "";
  const code = typeof named.code === "string" ? named.code.toLowerCase() : "";
  return name === "aborterror" || name.includes("timeout") ||
    code === "etimedout" || code.includes("timeout");
}
