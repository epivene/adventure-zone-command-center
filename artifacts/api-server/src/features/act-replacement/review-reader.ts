import { stableRelationshipIssues, type ActOrganizeManifest, type ManifestOutcome, type ManifestOperation } from "./manifest-builder";
import { projectActReviewDisplay } from "./review-display";
import { fingerprintSourceContent } from "./source-fingerprint";
import type { ContextClueFamily } from "./matching/context-clue-resolver";

export type ReviewIssueCode = "ambiguous_match" | "field_conflict" | "relationship_unresolved" | "unassigned" | "unsupported_record" | "unsupported_field";
export type ReviewSummary = {
  decisionRequired: number;
  archivedOnly: number;
  issueCounts: Partial<Record<ReviewIssueCode, number>>;
  diagnosticCounts: Partial<Record<ReviewIssueCode, number>>;
};
export type ReviewSafeValue = string | number | boolean | null;
export type ReviewIssue = { code: ReviewIssueCode; reason?: string };
export type ReviewCandidate = { id: string; entityType: string; label: string; detail: string | null };
export type ConflictReviewToken = {
  sourceRecordId: string;
  sourceVersionId: string;
  fieldName: string;
  sourceValueFingerprint: string;
  targetEntityType: string;
  targetEntityId: string;
  localValueFingerprint: string;
};
export type ReviewConflict = {
  fieldName: string;
  localValue: ReviewSafeValue;
  sourceValue: ReviewSafeValue;
  target?: ReviewCandidate;
  reviewToken?: ConflictReviewToken;
};
export type ReviewTargetProjection = ReviewCandidate & { fields?: Record<string, unknown> };
export type ReviewReadInput = { runId: string; page?: number; pageSize?: number; search?: string; state?: string; issue?: string };
export const assignmentTargetEntityTypes = ["organization", "contact", "booking", "calling_list", "activity"] as const;
export type AssignmentTargetEntityType = typeof assignmentTargetEntityTypes[number];
export type ReviewRelationshipIssue = {
  relationshipSlot: string;
  issueCode: "relationship_unresolved" | "unassigned";
  reason: string;
  expectedParentTypes: AssignmentTargetEntityType[];
  canImportStandalone: boolean;
};

export type ReviewSourceRecord = {
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: string;
  actRecordId?: string | null;
  display: Record<string, unknown>;
  raw?: unknown;
  versions?: Array<{ versionId: string; fetchedAt: string; scope: string; completeness: string }>;
};

export type ReviewRow = {
  sourceRecordId: string;
  sourceVersionId: string;
  state: ManifestOutcome["state"];
  issues: ReviewIssue[];
  conflicts: ReviewConflict[];
  candidates: ReviewCandidate[];
  relationshipIssues: ReviewRelationshipIssue[];
  canImportStandalone: boolean;
  operationKeys: string[];
  recommendation?: {
    action: "link_existing" | "import_new" | "assign_parent" | "keep_archived";
    target?: ReviewCandidate;
    confidence: "authoritative" | "two_independent_clues";
    evidence: Array<{ family: ContextClueFamily; label: string }>;
  };
  streamType?: string;
  display?: Record<string, unknown>;
};
export type ReviewPage = { rows: ReviewRow[]; page: number; pageSize: number; total: number; manifestDigest: string | null; summary: ReviewSummary };

export type ReviewReader = {
  getManifest(runId: string): Promise<ActOrganizeManifest | null>;
  listSources(runId: string): Promise<ReviewSourceRecord[]>;
  getSource?(sourceRecordId: string): Promise<ReviewSourceRecord | null>;
  readReviewPage?(input: ReviewReadInput): Promise<ReviewPage>;
  listAssignmentTargets?(query: { search?: string; entityType?: string; entityTypes?: string[] }): Promise<ReviewCandidate[]>;
};

const issueCodes: readonly ReviewIssueCode[] = [
  "ambiguous_match",
  "field_conflict",
  "relationship_unresolved",
  "unassigned",
  "unsupported_record",
  "unsupported_field",
];
const issueCodeSet = new Set<string>(issueCodes);
const reviewStates = new Set<ManifestOutcome["state"]>(["awaiting_review", "unassigned", "unsupported"]);
const targetModelByStream: Readonly<Record<string, { entityType: string }>> = {
  company: { entityType: "organization" },
  contact: { entityType: "contact" },
  opportunity: { entityType: "booking" },
  group: { entityType: "calling_list" },
  activity: { entityType: "activity" },
  note: { entityType: "activity" },
  history: { entityType: "activity" },
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const safeEvidenceLabels: Readonly<Record<ContextClueFamily, string>> = {
  identity: "Matching name",
  direct_contact: "Matching email or phone",
  web_identity: "Matching website",
  location: "Matching location",
  archive_relationship: "Matching saved relationship",
  event_context: "Matching event details",
  narrative_context: "Matching archived context",
};

function contextRecommendation(
  outcome: ManifestOutcome,
  model: { entityType: string } | null,
  targetByKey: ReadonlyMap<string, ReviewTargetProjection>,
): ReviewRow["recommendation"] {
  const match = object(outcome.match);
  const localId = typeof match.localId === "string" ? match.localId : null;
  if (match.kind !== "exact" || !localId || !model || !Array.isArray(match.evidence)) return undefined;
  const families = new Map<ContextClueFamily, string>();
  let authoritative = false;
  for (const rawEvidence of match.evidence.slice(0, 20)) {
    const evidence = object(rawEvidence);
    const family = evidence.family;
    if (typeof family !== "string" || !Object.hasOwn(safeEvidenceLabels, family)) continue;
    if (evidence.targetEntityId !== localId || evidence.targetEntityType !== model.entityType) continue;
    if (evidence.authority === "authoritative") authoritative = true;
    const typedFamily = family as ContextClueFamily;
    if (!families.has(typedFamily)) families.set(typedFamily, safeEvidenceLabels[typedFamily]);
  }
  if (!authoritative && families.size < 2) return undefined;
  const target = targetByKey.get(`${model.entityType}:${localId}`);
  return {
    action: "link_existing",
    ...(target ? { target: { id: target.id, entityType: target.entityType, label: target.label, detail: target.detail } } : {}),
    confidence: authoritative ? "authoritative" : "two_independent_clues",
    evidence: [...families.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 7)
      .map(([family, label]) => ({ family, label })),
  };
}

function safeValue(value: unknown): ReviewSafeValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizedIssues(outcome: Pick<ManifestOutcome, "issues">): ReviewIssue[] {
  const output: ReviewIssue[] = [];
  for (const rawIssue of outcome.issues) {
    const raw = object(rawIssue);
    const code = raw.code;
    if (typeof code !== "string" || !issueCodeSet.has(code)) continue;
    output.push({
      code: code as ReviewIssueCode,
      ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
    });
  }
  return output;
}

function sanitizedRelationshipIssues(outcome: Pick<ManifestOutcome, "sourceRecordId" | "sourceVersionId" | "issues">): ReviewRelationshipIssue[] {
  return stableRelationshipIssues(outcome.sourceRecordId, outcome.sourceVersionId, outcome.issues).flatMap((rawIssue) => {
    const raw = object(rawIssue);
    const issueCode = raw.code;
    const relationshipSlot = typeof raw.relationshipSlot === "string" ? raw.relationshipSlot.trim() : "";
    const reason = typeof raw.reason === "string" ? raw.reason : "";
    const expectedParentTypes = Array.isArray(raw.expectedParentTypes)
      ? [...new Set(raw.expectedParentTypes.filter((value): value is AssignmentTargetEntityType => typeof value === "string" && isAssignmentTargetEntityType(value)))]
      : [];
    if ((issueCode !== "relationship_unresolved" && issueCode !== "unassigned") || !relationshipSlot || !reason) return [];
    return [{
      relationshipSlot,
      issueCode,
      reason,
      expectedParentTypes,
      canImportStandalone: raw.canImportStandalone === true,
    }];
  });
}

export function summarizeReviewOutcomes(outcomes: readonly Pick<ManifestOutcome, "sourceRecordId" | "state" | "issues">[]): ReviewSummary {
  const issueCounts: Partial<Record<ReviewIssueCode, number>> = {};
  const diagnosticCounts: Partial<Record<ReviewIssueCode, number>> = {};
  for (const outcome of outcomes) {
    for (const issue of sanitizedIssues(outcome)) {
      if (issue.code === "unsupported_field") {
        diagnosticCounts[issue.code] = (diagnosticCounts[issue.code] ?? 0) + 1;
      } else {
        issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
      }
    }
  }
  return {
    decisionRequired: 0,
    archivedOnly: outcomes.filter((outcome) => reviewStates.has(outcome.state)).length,
    issueCounts,
    diagnosticCounts,
  };
}

function targetModel(streamType: string | undefined) {
  return targetModelByStream[streamType?.toLowerCase() ?? ""];
}

export function isAssignmentTargetEntityType(value: string): value is AssignmentTargetEntityType {
  return assignmentTargetEntityTypes.includes(value as AssignmentTargetEntityType);
}

export function normalizeAssignmentTargetLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function assignmentTargetLikePattern(value: string | undefined): string | null {
  const normalized = normalizeAssignmentTargetLabel(value ?? "");
  return normalized ? `%${normalized.replace(/[\\%_]/g, "\\$&")}%` : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function filterAssignmentTargets(
  targets: readonly ReviewTargetProjection[],
  query: { search?: string; entityType?: string; entityTypes?: string[] },
): ReviewCandidate[] {
  if (query.entityType && !isAssignmentTargetEntityType(query.entityType)) return [];
  if (query.entityTypes?.some((entityType) => !isAssignmentTargetEntityType(entityType))) return [];
  const allowedTypes = query.entityType ? new Set([query.entityType]) : query.entityTypes?.length ? new Set(query.entityTypes) : null;
  const search = normalizeAssignmentTargetLabel(query.search ?? "");
  return targets
    .filter((target) => isAssignmentTargetEntityType(target.entityType))
    .filter((target) => !allowedTypes || allowedTypes.has(target.entityType))
    .filter((target) => !search || normalizeAssignmentTargetLabel(target.label).includes(search))
    .sort((left, right) =>
      compareText(normalizeAssignmentTargetLabel(left.label), normalizeAssignmentTargetLabel(right.label))
      || compareText(left.id, right.id)
      || compareText(left.entityType, right.entityType),
    )
    .slice(0, 25)
    .map(({ fields: _fields, ...target }) => ({ ...target }));
}

export function projectReviewRow(input: {
  outcome: ManifestOutcome;
  source?: ReviewSourceRecord;
  operations?: readonly Pick<ManifestOperation, "sourceRecordId" | "targetType" | "action" | "payload">[];
  targets?: readonly ReviewTargetProjection[];
}): ReviewRow {
  const issues = sanitizedIssues(input.outcome);
  const relationshipIssues = sanitizedRelationshipIssues(input.outcome);
  const sourceOperations = (input.operations ?? []).filter((operation) => operation.sourceRecordId === input.outcome.sourceRecordId);
  const targetByKey = new Map((input.targets ?? []).map((target) => [`${target.entityType}:${target.id}`, target]));
  const model = targetModel(input.source?.streamType);
  const recommendation = contextRecommendation(input.outcome, model, targetByKey);
  const candidates = input.outcome.candidates.flatMap((candidate) => {
    const candidateId = object(candidate).candidateId;
    const target = typeof candidateId === "string" && model
      ? targetByKey.get(`${model.entityType}:${candidateId}`)
      : undefined;
    return target
      ? [{ id: target.id, entityType: target.entityType, label: target.label, detail: target.detail }]
      : [];
  });
  const conflicts = issues
    .filter((issue): issue is ReviewIssue & { reason: string } => issue.code === "field_conflict" && Boolean(issue.reason))
    .map((issue): ReviewConflict => {
      const overwrite = sourceOperations.find((operation) => object(operation.payload).fieldName === issue.reason);
      const root = sourceOperations.find((operation) => {
        const payload = object(operation.payload);
        return operation.action === "link_existing" && Object.hasOwn(object(payload.normalized), issue.reason);
      });
      const operation = overwrite ?? root;
      const payload = object(operation?.payload);
      const proof = object(payload.proof);
      const localId = typeof payload.localId === "string"
        ? payload.localId
        : typeof payload.entityId === "string"
          ? payload.entityId
          : typeof object(input.outcome.match).localId === "string"
            ? object(input.outcome.match).localId as string
            : "";
      const localTarget = operation
        ? targetByKey.get(`${operation.targetType}:${localId}`)
        : undefined;
      const sourceValue = Object.hasOwn(proof, "sourceValue")
        ? proof.sourceValue
        : object(payload.normalized)[issue.reason];
      const localValue = Object.hasOwn(proof, "localValue")
        ? proof.localValue
        : localTarget?.fields?.[issue.reason];
      const safeLocalValue = safeValue(localValue);
      const safeSourceValue = safeValue(sourceValue);
      return {
        fieldName: issue.reason,
        localValue: safeLocalValue,
        sourceValue: safeSourceValue,
        ...(localTarget && localId && operation
          ? {
              target: {
                id: localTarget.id,
                entityType: localTarget.entityType,
                label: localTarget.label,
                detail: localTarget.detail,
              },
              reviewToken: {
                sourceRecordId: input.outcome.sourceRecordId,
                sourceVersionId: input.outcome.sourceVersionId,
                fieldName: issue.reason,
                sourceValueFingerprint: fingerprintSourceContent({ value: safeSourceValue }),
                targetEntityType: operation.targetType,
                targetEntityId: localId,
                localValueFingerprint: fingerprintSourceContent({ value: safeLocalValue }),
              },
            }
          : {}),
      };
    });
  return {
    sourceRecordId: input.outcome.sourceRecordId,
    sourceVersionId: input.outcome.sourceVersionId,
    state: input.outcome.state,
    issues,
    conflicts,
    candidates,
    relationshipIssues,
    canImportStandalone: relationshipIssues.some((issue) => issue.canImportStandalone),
    operationKeys: [...input.outcome.operationKeys],
    ...(recommendation ? { recommendation } : {}),
    ...(input.source?.streamType ? { streamType: input.source.streamType } : {}),
    ...(input.source?.display ? { display: projectActReviewDisplay(input.source.streamType, input.source.display) } : {}),
  };
}

export function safeSource(source: ReviewSourceRecord, includeRaw = false) {
  const result: ReviewSourceRecord = {
    sourceRecordId: source.sourceRecordId,
    sourceVersionId: source.sourceVersionId,
    streamType: source.streamType,
    actRecordId: source.actRecordId ?? null,
    display: { ...source.display },
    versions: source.versions?.map((version) => ({ ...version })),
  };
  // Raw source payloads are never returned from list/search. Details may expose
  // sanitized archive JSON only when the owner explicitly asks for it.
  if (includeRaw && source.raw !== undefined) result.raw = sanitizeRaw(source.raw);
  return result;
}

function sanitizeRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRaw);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes("password") || lower.includes("secret") || lower.includes("token") || lower.includes("authorization") || lower.includes("cookie")) continue;
    output[key] = sanitizeRaw(child);
  }
  return output;
}

export class InMemoryReviewReader implements ReviewReader {
  private manifests = new Map<string, ActOrganizeManifest>();
  private sources = new Map<string, ReviewSourceRecord[]>();
  targets: ReviewTargetProjection[] = [];
  seed(runId: string, manifest: ActOrganizeManifest, sources: ReviewSourceRecord[] = [], targets: ReviewTargetProjection[] = []) { this.manifests.set(runId, manifest); this.sources.set(runId, sources.map((source) => ({ ...source }))); this.targets = targets.map((target) => ({ ...target, fields: target.fields ? { ...target.fields } : undefined })); }
  async getManifest(runId: string) { return this.manifests.get(runId) ?? null; }
  async listSources(runId: string) { return (this.sources.get(runId) ?? []).map((source) => ({ ...source })); }
  async getSource(sourceRecordId: string) { for (const sources of this.sources.values()) { const found = sources.find((source) => source.sourceRecordId === sourceRecordId); if (found) return { ...found }; } return null; }
  async listAssignmentTargets(query: { search?: string; entityType?: string; entityTypes?: string[] }) {
    return filterAssignmentTargets(this.targets, query);
  }
}

export async function readReview(reader: ReviewReader, input: ReviewReadInput): Promise<ReviewPage> {
  if (reader.readReviewPage) return reader.readReviewPage(input);
  const manifest = await reader.getManifest(input.runId);
  if (!manifest) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found" });
  const sources = await reader.listSources(input.runId);
  const sourceById = new Map(sources.map((source) => [source.sourceRecordId, source]));
  const search = input.search?.trim().toLowerCase();
  const outcomes = manifest.outcomes.filter((outcome) => {
    const source = sourceById.get(outcome.sourceRecordId);
    if (
      input.state === "needs_review" &&
      !["awaiting_review", "unassigned", "unsupported"].includes(outcome.state)
    ) return false;
    if (input.state && input.state !== "needs_review" && outcome.state !== input.state) return false;
    if (input.issue && !outcome.issues.some((item) => item.code === input.issue)) return false;
    if (!search) return true;
    const display = projectActReviewDisplay(source?.streamType, source?.display);
    return `${outcome.sourceRecordId} ${source?.streamType ?? ""} ${JSON.stringify(display)}`.toLowerCase().includes(search);
  });
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = [25, 50, 100, 200].includes(input.pageSize ?? 50) ? (input.pageSize ?? 50) : 50;
  const pageOutcomes = outcomes.slice((page - 1) * pageSize, page * pageSize);
  return {
    rows: pageOutcomes.map((outcome) => projectReviewRow({
      outcome,
      source: sourceById.get(outcome.sourceRecordId),
      operations: manifest.operations.filter((operation) => operation.sourceRecordId === outcome.sourceRecordId),
      targets: reader instanceof InMemoryReviewReader ? reader.targets : [],
    })),
    page,
    pageSize,
    total: outcomes.length,
    manifestDigest: manifest.digest,
    summary: summarizeReviewOutcomes(manifest.outcomes),
  };
}

export function manifestOperations(manifest: ActOrganizeManifest | null): ManifestOperation[] { return manifest?.operations ?? []; }

/** Public manifest projection: operation payloads can contain normalized/custom
 * archive data and are intentionally not exposed by the review list endpoint. */
export function safeManifest(manifest: ActOrganizeManifest) {
  return {
    digest: manifest.digest,
    diagnostics: manifest.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    outcomes: manifest.outcomes.map((outcome) => ({ ...outcome })),
    operations: manifest.operations.map((operation) => ({
      operationKey: operation.operationKey,
      sourceRecordId: operation.sourceRecordId,
      sourceVersionId: operation.sourceVersionId,
      targetType: operation.targetType,
      action: operation.action,
      dependencyOperationKeys: [...operation.dependencyOperationKeys],
      requiredForSourceOutcome: operation.requiredForSourceOutcome,
      safeByDefault: operation.safeByDefault,
    })),
  };
}
