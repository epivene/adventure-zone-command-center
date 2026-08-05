#!/usr/bin/env tsx

/**
 * Metadata-only production handoff report for the Act! replacement import.
 *
 * This intentionally consumes the persisted reconciliation projection and
 * never serializes review display/raw source values. It is safe to redirect
 * to a file or attach to a handoff ticket.
 */

export const ACT_REPORT_STREAMS = [
  "company", "contact", "opportunity", "group",
  "company_contact", "opportunity_company", "opportunity_contact", "group_contact",
  "activity", "note", "history",
  "activity_contact", "activity_company", "activity_opportunity",
  "note_contact", "note_company", "note_opportunity",
  "history_contact", "history_company", "history_opportunity",
] as const;

export const ACT_DISPLAY_AGGREGATES = [
  "organizations", "contacts", "bookings", "calling_lists", "activities", "relationships", "provenance",
] as const;

type Counts = {
  linkedApplied: number;
  alreadyPresent: number;
  awaitingReview: number;
  unassigned: number;
  unsupported: number;
  failed: number;
  ready: number;
};

type ReportStream = {
  streamType: string;
  counts: Counts;
  observedIdentities: number;
  archivedIdentities: number;
  organizedCount?: number;
  issues?: Array<{ code?: string }>;
};

type Reconciliation = {
  runId: string;
  sourceDatabaseKey?: string;
  phase: string;
  complete: boolean;
  finalizable?: boolean;
  streams: ReportStream[];
  allStreams: Counts & { observedIdentities: number; archivedIdentities: number; organizedCount?: number };
  rollups: Array<{ name: string; count: number; informational?: true }>;
  issues: Array<{ code?: string }>;
  digest: string;
};

export type ActReplacementReportInput = {
  status: {
    runId: string;
    phase: string;
    previewOnly: boolean;
    allStreams?: { observedIdentities?: number; archivedIdentities?: number };
    applyEnabled?: boolean;
    applyBatches?: Array<{ state?: string }>;
    durableAdapters?: { reviewReader?: boolean; commandService?: boolean; applyRepository?: boolean };
    reconciliation?: Reconciliation;
  };
  review?: { total?: number; manifestDigest?: string | null; rows?: Array<{ sourceRecordId?: string; streamType?: string; state?: string; display?: unknown; raw?: unknown }> };
  reconciliation?: Reconciliation;
};

export class ReportValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Act replacement report validation failed: ${errors.join("; ")}`);
    this.name = "ReportValidationError";
  }
}

const COUNT_KEYS: Array<keyof Counts> = ["linkedApplied", "alreadyPresent", "awaitingReview", "unassigned", "unsupported", "failed", "ready"];
const relationshipStreams = ACT_REPORT_STREAMS.filter((stream) => stream.includes("_"));
const n = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

function validate(input: ActReplacementReportInput, report: Reconciliation): string[] {
  const errors: string[] = [];
  if (!input.status.previewOnly) errors.push("previewOnly must be true");
  if (input.status.applyEnabled === true) errors.push("production apply is enabled");
  if ((input.status.applyBatches ?? []).length > 0) errors.push("production apply batches must be empty");
  const adapters = input.status.durableAdapters;
  if (adapters && (!adapters.reviewReader || !adapters.commandService || !adapters.applyRepository)) {
    errors.push("durable review/apply adapters are unavailable");
  }
  if (report.phase !== "complete" && report.phase !== "complete_with_issues") errors.push(`reconciliation phase is ${report.phase}`);
  if (report.runId !== input.status.runId) errors.push("reconciliation run does not match status run");
  if (!report.finalizable && report.complete) errors.push("reconciliation marks complete but is not finalizable");
  const byName = new Map(report.streams.map((stream) => [stream.streamType, stream]));
  for (const streamType of ACT_REPORT_STREAMS) {
    const stream = byName.get(streamType);
    if (!stream) {
      errors.push(`missing ${streamType.includes("_") ? "relationship " : ""}stream ${streamType}`);
      continue;
    }
    const total = COUNT_KEYS.reduce((sum, key) => sum + n(stream.counts?.[key]), 0);
    if (total !== n(stream.archivedIdentities)) errors.push(`${streamType} identity equation mismatch`);
    if (n(stream.observedIdentities) !== n(stream.archivedIdentities)) errors.push(`${streamType} observed/archived equation mismatch`);
    if (n(stream.counts.ready) > 0) errors.push(`${streamType} has ready sources; it cannot be complete`);
  }
  const allTotal = COUNT_KEYS.reduce((sum, key) => sum + n(report.allStreams?.[key]), 0);
  if (allTotal !== n(report.allStreams.archivedIdentities)) errors.push("all-stream identity equation mismatch");
  if (n(report.allStreams.observedIdentities) !== n(report.allStreams.archivedIdentities)) errors.push("all-stream observed/archived equation mismatch");
  if (n(report.allStreams.ready) > 0) errors.push("all-stream has ready sources; it cannot be complete");
  const streamArchived = report.streams.reduce((sum, stream) => sum + n(stream.archivedIdentities), 0);
  if (streamArchived !== n(report.allStreams.archivedIdentities)) errors.push("all-stream does not reconcile stream totals");
  if (report.rollups.length !== ACT_DISPLAY_AGGREGATES.length || ACT_DISPLAY_AGGREGATES.some((name) => !report.rollups.some((rollup) => rollup.name === name))) errors.push("display aggregates are incomplete");
  if (report.issues.length > 0) errors.push("reconciliation contains issues");
  return [...new Set(errors)];
}

function csv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const headers = ["section", "name", "archived", "observed", ...COUNT_KEYS, "organized", "issue_count"];
function row(section: string, name: string, archived: number, observed: number, counts: Partial<Counts>, organized = 0, issueCount = 0) {
  return [section, name, archived, observed, ...COUNT_KEYS.map((key) => n(counts[key])), organized, issueCount].map(csv).join(",");
}

export function reportActReplacementImport(input: ActReplacementReportInput): { csv: string; runId: string; manifestDigest: string | null; digest: string; previewOnly: true } {
  const report = input.reconciliation;
  if (!report) throw new ReportValidationError(["authoritative reconciliation report is unavailable"]);
  const errors = validate(input, report);
  if (errors.length) throw new ReportValidationError(errors);
  const lines = [headers.join(",")];
  for (const streamType of ACT_REPORT_STREAMS) {
    const stream = report.streams.find((candidate) => candidate.streamType === streamType)!;
    lines.push(row("stream", stream.streamType, stream.archivedIdentities, stream.observedIdentities, stream.counts, stream.organizedCount, stream.issues?.length));
  }
  for (const aggregate of ACT_DISPLAY_AGGREGATES) {
    const rollup = report.rollups.find((candidate) => candidate.name === aggregate)!;
    lines.push(row("aggregate", aggregate, rollup.count, rollup.count, {}, 0, 0));
  }
  lines.push(row("all-stream", "all-stream", report.allStreams.archivedIdentities, report.allStreams.observedIdentities, report.allStreams, report.allStreams.organizedCount));
  return { csv: `${lines.join("\n")}\n`, runId: report.runId, manifestDigest: input.review?.manifestDigest ?? null, digest: report.digest, previewOnly: true };
}

function endpoint(base: string, path: string) { return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`; }
async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`preview endpoint returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function main() {
  const baseUrl = process.env.ACT_PREVIEW_BASE_URL ?? "http://localhost:10000/api";
  const token = process.env.ACT_PREVIEW_OWNER_TOKEN;
  const requestedRunId = process.env.ACT_PREVIEW_RUN_ID;
  const latest = requestedRunId ? null : await getJson<{ run: ActReplacementReportInput["status"] | null }>(endpoint(baseUrl, "/migration/act-replacement/runs/latest"), token);
  const status = latest?.run ?? await getJson<{ run: ActReplacementReportInput["status"] }>(endpoint(baseUrl, `/migration/act-replacement/runs/${encodeURIComponent(requestedRunId!)}`), token).then((body) => body.run);
  if (!status) throw new Error("no durable Act replacement run found");
  const review = await getJson<{ manifestDigest?: string | null; rows?: Array<{ sourceRecordId?: string; streamType?: string; state?: string; display?: unknown; raw?: unknown }>; total?: number }>(endpoint(baseUrl, `/migration/act-replacement/runs/${encodeURIComponent(status.runId)}/review?page=1&pageSize=200`), token);
  const rows = [...(review.rows ?? [])];
  const reviewTotal = review.total ?? rows.length;
  for (let page = 2; rows.length < reviewTotal && page <= 100; page += 1) {
    const next = await getJson<typeof review>(endpoint(baseUrl, `/migration/act-replacement/runs/${encodeURIComponent(status.runId)}/review?page=${page}&pageSize=200`), token);
    rows.push(...(next.rows ?? []));
  }
  if (rows.length < reviewTotal) throw new Error("owner review endpoint did not return the complete review set");
  const probed = new Set<string>();
  for (const row of rows) {
    if (!row.sourceRecordId || probed.has(row.sourceRecordId)) continue;
    probed.add(row.sourceRecordId);
    const source = await getJson<{ source?: unknown }>(endpoint(baseUrl, `/migration/act-replacement/source-records/${encodeURIComponent(row.sourceRecordId)}?runId=${encodeURIComponent(status.runId)}`), token);
    assertSafeSourceProjection(source.source);
  }
  const manifest = await getJson<{ reconciliation?: Reconciliation; report?: Reconciliation }>(endpoint(baseUrl, `/migration/act-replacement/runs/${encodeURIComponent(status.runId)}/manifest`), token);
  const result = reportActReplacementImport({ status, review, reconciliation: status.reconciliation ?? manifest.reconciliation ?? manifest.report });
  process.stdout.write(result.csv);
}

function assertSafeSourceProjection(value: unknown): void {
  const forbidden = /password|secret|token|authorization|cookie/i;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (forbidden.test(key)) throw new Error("owner source-detail response contains a sensitive field");
      walk(child);
    }
  };
  walk(value);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Act replacement report failed"); process.exitCode = 1; });
