import type { ActOrganizeManifest, ManifestOutcome, ManifestOperation } from "./manifest-builder";

export type ReviewSourceRecord = {
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: string;
  actRecordId?: string | null;
  display: Record<string, unknown>;
  raw?: unknown;
  versions?: Array<{ versionId: string; fetchedAt: string; scope: string; completeness: string }>;
};

export type ReviewRow = ManifestOutcome & { streamType?: string; display?: Record<string, unknown> };
export type ReviewPage = { rows: ReviewRow[]; page: number; pageSize: number; total: number; manifestDigest: string | null };

export type ReviewReader = {
  getManifest(runId: string): Promise<ActOrganizeManifest | null>;
  listSources(runId: string): Promise<ReviewSourceRecord[]>;
  getSource?(sourceRecordId: string): Promise<ReviewSourceRecord | null>;
};

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
  seed(runId: string, manifest: ActOrganizeManifest, sources: ReviewSourceRecord[] = []) { this.manifests.set(runId, manifest); this.sources.set(runId, sources.map((source) => ({ ...source }))); }
  async getManifest(runId: string) { return this.manifests.get(runId) ?? null; }
  async listSources(runId: string) { return (this.sources.get(runId) ?? []).map((source) => ({ ...source })); }
  async getSource(sourceRecordId: string) { for (const sources of this.sources.values()) { const found = sources.find((source) => source.sourceRecordId === sourceRecordId); if (found) return { ...found }; } return null; }
}

export async function readReview(reader: ReviewReader, input: { runId: string; page?: number; pageSize?: number; search?: string; state?: string; issue?: string }): Promise<ReviewPage> {
  const manifest = await reader.getManifest(input.runId);
  if (!manifest) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found" });
  const sources = await reader.listSources(input.runId);
  const sourceById = new Map(sources.map((source) => [source.sourceRecordId, source]));
  const search = input.search?.trim().toLowerCase();
  const rows = manifest.outcomes.filter((outcome) => {
    const source = sourceById.get(outcome.sourceRecordId);
    if (
      input.state === "needs_review" &&
      !["awaiting_review", "unassigned", "unsupported"].includes(outcome.state)
    ) return false;
    if (input.state && input.state !== "needs_review" && outcome.state !== input.state) return false;
    if (input.issue && !outcome.issues.some((item) => item.code === input.issue)) return false;
    if (!search) return true;
    return `${outcome.sourceRecordId} ${source?.streamType ?? ""} ${JSON.stringify(source?.display ?? {})}`.toLowerCase().includes(search);
  }).map((outcome) => ({ ...outcome, streamType: sourceById.get(outcome.sourceRecordId)?.streamType, display: sourceById.get(outcome.sourceRecordId)?.display }));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = [25, 50, 100, 200].includes(input.pageSize ?? 50) ? (input.pageSize ?? 50) : 50;
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length, manifestDigest: manifest.digest };
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
