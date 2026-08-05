import { createHash } from "node:crypto";
import { actReplacementStreamTypes, type ActReplacementOutcomeState, type ActReplacementRunPhase, type ActReplacementStreamType } from "./import-types";

export type ActOutcomeCounts = { linkedApplied: number; alreadyPresent: number; awaitingReview: number; unassigned: number; unsupported: number; failed: number; ready: number };
export type ReconciliationIssue = { code: string; streamType?: string; sourceRecordId?: string; operationId?: string; detail?: string };
export type ReconciliationObservation = { sourceRecordId: string; versionId: string };
export type ReconciliationOutcome = { sourceRecordId: string; state: ActReplacementOutcomeState };
export type ReconciliationOperation = { id: string; sourceRecordId?: string; status: "pending" | "leased" | "applied" | "already_present" | "blocked" | "failed"; approvedAt?: string | null; blockReason?: string | null; requiredForSourceOutcome?: boolean };
export type ReconciliationCheckpoint = { state: string; responseRows?: number; observedIdentities?: number; archivedIdentities?: number; completeIdentities?: number; partialIdentities?: number; failedIdentities?: number; snapshotVersionsInserted?: number };
export type ReconciliationBatch = { state: string };
export type ReconciliationStreamInput = { streamType: string; checkpoints: readonly ReconciliationCheckpoint[]; observations: readonly ReconciliationObservation[]; versions: readonly string[]; outcomes: readonly ReconciliationOutcome[]; operations: readonly ReconciliationOperation[]; batches: readonly ReconciliationBatch[] };
export type ReconciliationInput = { runId: string; sourceDatabaseKey: string; phase: ActReplacementRunPhase; streams: readonly ReconciliationStreamInput[] };
export type ReconciliationStreamReport = { streamType: string; counts: ActOutcomeCounts; responseRows: number; observedIdentities: number; archivedIdentities: number; completeIdentities: number; partialIdentities: number; failedIdentities: number; versionsInserted: number; organizedCount: number; issues: ReconciliationIssue[] };
export type ReconciliationReport = { runId: string; sourceDatabaseKey: string; phase: "complete" | "complete_with_issues"; complete: boolean; finalizable: boolean; streams: ReconciliationStreamReport[]; allStreams: ActOutcomeCounts & { responseRows: number; observedIdentities: number; archivedIdentities: number; completeIdentities: number; partialIdentities: number; failedIdentities: number; versionsInserted: number; organizedCount: number }; rollups: Array<{ name: string; count: number; informational: true }>; issues: ReconciliationIssue[]; digest: string };

const emptyCounts = (): ActOutcomeCounts => ({ linkedApplied: 0, alreadyPresent: 0, awaitingReview: 0, unassigned: 0, unsupported: 0, failed: 0, ready: 0 });
const terminalCheckpoint = (state: string) => ["complete", "unsupported", "failed"].includes(state);
const terminalOperation = (state: ReconciliationOperation["status"]) => ["applied", "already_present", "blocked", "failed"].includes(state);
const outcomeBucket = (state: ActReplacementOutcomeState): keyof ActOutcomeCounts | null => {
  if (state === "applied") return "linkedApplied";
  if (state === "already_present") return "alreadyPresent";
  if (state === "awaiting_review") return "awaitingReview";
  if (["unassigned", "unsupported", "failed", "ready"].includes(state)) return state as keyof ActOutcomeCounts;
  return null;
};

/** Pure, owner-scoped, read-only reconciliation. It never mutates a run or queues work. */
export function reconcileActReplacement(input: ReconciliationInput): ReconciliationReport {
  const issues: ReconciliationIssue[] = [];
  if (input.phase !== "complete" && input.phase !== "complete_with_issues") issues.push({ code: "run_phase_not_final", detail: input.phase });
  const knownStreams = new Set<string>(actReplacementStreamTypes);
  const streamNames = new Set<string>();
  for (const stream of input.streams) {
    if (!knownStreams.has(stream.streamType)) issues.push({ code: "unknown_stream", streamType: stream.streamType });
    if (streamNames.has(stream.streamType)) issues.push({ code: "duplicate_stream", streamType: stream.streamType });
    streamNames.add(stream.streamType);
  }
  const byType = new Map<string, ReconciliationStreamInput>();
  for (const stream of input.streams) {
    const prior = byType.get(stream.streamType);
    // Duplicate stream inputs are invalid, but select a canonical representative
    // so the diagnostic digest does not depend on request array ordering.
    if (!prior || JSON.stringify(stream) < JSON.stringify(prior)) byType.set(stream.streamType, stream);
  }
  const reports: ReconciliationStreamReport[] = [];
  for (const streamType of actReplacementStreamTypes) {
    const stream = byType.get(streamType) ?? { streamType, checkpoints: [], observations: [], versions: [], outcomes: [], operations: [], batches: [] };
    const streamIssues: ReconciliationIssue[] = [];
    for (const checkpoint of stream.checkpoints) if (!terminalCheckpoint(checkpoint.state)) streamIssues.push({ code: "checkpoint_nonterminal", streamType, detail: checkpoint.state });
    const versions = new Set(stream.versions);
    const outcomes = new Map<string, ReconciliationOutcome>();
    for (const outcome of stream.outcomes) {
      if (outcomes.has(outcome.sourceRecordId)) streamIssues.push({ code: "duplicate_outcome", streamType, sourceRecordId: outcome.sourceRecordId });
      outcomes.set(outcome.sourceRecordId, outcome);
    }
    const seen = new Set<string>();
    for (const observation of stream.observations) {
      if (seen.has(observation.sourceRecordId)) streamIssues.push({ code: "duplicate_observation", streamType, sourceRecordId: observation.sourceRecordId });
      seen.add(observation.sourceRecordId);
      if (!versions.has(observation.versionId)) streamIssues.push({ code: "observation_version_missing", streamType, sourceRecordId: observation.sourceRecordId });
      if (!outcomes.has(observation.sourceRecordId)) streamIssues.push({ code: "observation_outcome_missing", streamType, sourceRecordId: observation.sourceRecordId });
      else if (outcomes.get(observation.sourceRecordId)!.state === "pending" || outcomes.get(observation.sourceRecordId)!.state === "leased" || outcomes.get(observation.sourceRecordId)!.state === "ready") streamIssues.push({ code: "outcome_nonterminal", streamType, sourceRecordId: observation.sourceRecordId, detail: outcomes.get(observation.sourceRecordId)!.state });
    }
    for (const outcome of stream.outcomes) if (!seen.has(outcome.sourceRecordId)) streamIssues.push({ code: "outcome_without_observation", streamType, sourceRecordId: outcome.sourceRecordId });
    for (const operation of stream.operations) {
      if (!terminalOperation(operation.status) && !operation.blockReason) streamIssues.push({ code: "operation_nonterminal", streamType, operationId: operation.id, detail: operation.status });
      if (operation.approvedAt && !terminalOperation(operation.status)) streamIssues.push({ code: "approved_operation_unfinished", streamType, operationId: operation.id });
      if (operation.status === "blocked" && !operation.blockReason) streamIssues.push({ code: "blocked_operation_without_reason", streamType, operationId: operation.id });
      if (operation.sourceRecordId && !seen.has(operation.sourceRecordId)) streamIssues.push({ code: "operation_without_observation", streamType, sourceRecordId: operation.sourceRecordId, operationId: operation.id });
    }
    const requiredBySource = new Map<string, ReconciliationOperation[]>();
    for (const operation of stream.operations) if (operation.requiredForSourceOutcome !== false && operation.sourceRecordId) {
      const list = requiredBySource.get(operation.sourceRecordId) ?? []; list.push(operation); requiredBySource.set(operation.sourceRecordId, list);
    }
    for (const outcome of stream.outcomes) {
      const required = requiredBySource.get(outcome.sourceRecordId) ?? [];
      if (outcome.state === "applied" && required.some((operation) => !["applied", "already_present"].includes(operation.status))) streamIssues.push({ code: "required_operation_aggregate_mismatch", streamType, sourceRecordId: outcome.sourceRecordId });
    }
    for (const batch of stream.batches) if (["queued", "applying"].includes(batch.state)) streamIssues.push({ code: "active_batch", streamType, detail: batch.state });
    const counts = emptyCounts();
    for (const outcome of stream.outcomes) { const bucket = outcomeBucket(outcome.state); if (bucket) counts[bucket]++; }
    const checkpointTotals = stream.checkpoints.reduce((acc, checkpoint) => ({ responseRows: acc.responseRows + (checkpoint.responseRows ?? 0), observedIdentities: acc.observedIdentities + (checkpoint.observedIdentities ?? 0), archivedIdentities: acc.archivedIdentities + (checkpoint.archivedIdentities ?? 0), completeIdentities: acc.completeIdentities + (checkpoint.completeIdentities ?? 0), partialIdentities: acc.partialIdentities + (checkpoint.partialIdentities ?? 0), failedIdentities: acc.failedIdentities + (checkpoint.failedIdentities ?? 0), versionsInserted: acc.versionsInserted + (checkpoint.snapshotVersionsInserted ?? 0) }), { responseRows: 0, observedIdentities: 0, archivedIdentities: 0, completeIdentities: 0, partialIdentities: 0, failedIdentities: 0, versionsInserted: 0 });
    const archived = stream.observations.length;
    if (checkpointTotals.observedIdentities && checkpointTotals.observedIdentities !== archived) streamIssues.push({ code: "observed_identity_count_mismatch", streamType, detail: `${checkpointTotals.observedIdentities}:${archived}` });
    if (checkpointTotals.archivedIdentities && checkpointTotals.archivedIdentities !== archived) streamIssues.push({ code: "archived_identity_count_mismatch", streamType, detail: `${checkpointTotals.archivedIdentities}:${archived}` });
    if (counts.linkedApplied + counts.alreadyPresent + counts.awaitingReview + counts.unassigned + counts.unsupported + counts.failed + counts.ready !== archived) streamIssues.push({ code: "identity_equation_mismatch", streamType, detail: `${archived}` });
    const row: ReconciliationStreamReport = { streamType, counts, ...checkpointTotals, archivedIdentities: archived, organizedCount: stream.outcomes.length, issues: streamIssues.sort(issueSort) };
    reports.push(row); issues.push(...row.issues);
  }
  const all = reports.reduce((acc, row) => { for (const key of Object.keys(acc) as Array<keyof typeof acc>) acc[key] += row[key] as number; return acc; }, { ...emptyCounts(), responseRows: 0, observedIdentities: 0, archivedIdentities: 0, completeIdentities: 0, partialIdentities: 0, failedIdentities: 0, versionsInserted: 0, organizedCount: 0 });
  const reviewCount = all.awaitingReview + all.unassigned + all.unsupported + all.failed;
  const blocking = issues.length > 0 || all.ready > 0;
  const complete = !blocking && reviewCount === 0;
  const rollupNames = ["organizations", "contacts", "bookings", "calling_lists", "activities", "relationships", "provenance"];
  const rollups = rollupNames.map((name) => ({ name, count: 0, informational: true as const }));
  const canonical = { runId: input.runId, sourceDatabaseKey: input.sourceDatabaseKey, phase: complete ? "complete" as const : "complete_with_issues" as const, complete, finalizable: complete, streams: reports, allStreams: all, rollups, issues: issues.sort(issueSort) };
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { ...canonical, digest };
}

function issueSort(a: ReconciliationIssue, b: ReconciliationIssue) { return (a.streamType ?? "").localeCompare(b.streamType ?? "") || (a.sourceRecordId ?? "").localeCompare(b.sourceRecordId ?? "") || a.code.localeCompare(b.code) || (a.operationId ?? "").localeCompare(b.operationId ?? "") || (a.detail ?? "").localeCompare(b.detail ?? ""); }
