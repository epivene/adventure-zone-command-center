import { describe, expect, it } from "vitest";
import { reconcileActReplacement, type ReconciliationInput } from "./reconciliation-service";

const base = (): ReconciliationInput => ({
  runId: "run", sourceDatabaseKey: "db", phase: "complete",
  streams: [{ streamType: "company", checkpoints: [{ state: "complete" }], observations: [{ sourceRecordId: "a", versionId: "v" }], versions: ["v"], outcomes: [{ sourceRecordId: "a", state: "applied" }], operations: [], batches: [] }],
});

describe("Act replacement reconciliation", () => {
  it("accounts for every identity and emits deterministic all-stream totals", () => {
    const report = reconcileActReplacement(base());
    expect(report.phase).toBe("complete");
    expect(report.complete).toBe(true);
    expect(report.streams[0].counts).toMatchObject({ archivedIdentities: 1, linkedApplied: 1 });
    expect(report.allStreams.archivedIdentities).toBe(1);
    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks completion when an observation has no matching version/outcome", () => {
    const input = base();
    input.streams[0].observations.push({ sourceRecordId: "missing", versionId: "nope" });
    const report = reconcileActReplacement(input);
    expect(report.complete).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["observation_version_missing", "observation_outcome_missing"]));
    expect(report.phase).toBe("complete_with_issues");
  });

  it("does not hide relationship identities in root rollups", () => {
    const input = base();
    input.streams.push({ streamType: "company_contact", checkpoints: [{ state: "complete" }], observations: [{ sourceRecordId: "r", versionId: "rv" }], versions: ["rv"], outcomes: [{ sourceRecordId: "r", state: "awaiting_review" }], operations: [], batches: [] });
    const report = reconcileActReplacement(input);
    expect(report.streams).toHaveLength(20);
    expect(report.streams.find((row) => row.streamType === "company_contact")?.counts.awaitingReview).toBe(1);
    expect(report.allStreams.awaitingReview).toBe(1);
    expect(report.rollups).toEqual(expect.any(Array));
  });

  it("maps persisted snake_case outcome states and requires a final phase", () => {
    const input = base();
    input.streams[0].outcomes = [{ sourceRecordId: "a", state: "already_present" }];
    const report = reconcileActReplacement(input);
    expect(report.streams[0].counts.alreadyPresent).toBe(1);
    expect(report.finalizable).toBe(true);
    input.phase = "organizing";
    expect(reconcileActReplacement(input).issues.some((issue) => issue.code === "run_phase_not_final")).toBe(true);
  });

  it("does not overwrite duplicate outcomes", () => {
    const input = base();
    input.streams[0].outcomes.push({ sourceRecordId: "a", state: "failed" });
    const report = reconcileActReplacement(input);
    expect(report.issues.some((issue) => issue.code === "duplicate_outcome")).toBe(true);
  });

  it("rejects active batches, pending work, and approved unfinished operations", () => {
    const input = base();
    input.phase = "ready_to_apply";
    input.streams[0].outcomes = [{ sourceRecordId: "a", state: "ready" }];
    input.streams[0].operations = [{ id: "op", sourceRecordId: "a", status: "pending", approvedAt: "2026-08-04T00:00:00Z" }];
    input.streams[0].batches = [{ state: "applying" }];
    const report = reconcileActReplacement(input);
    expect(report.complete).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["outcome_nonterminal", "approved_operation_unfinished", "active_batch"]));
  });

  it("is stable regardless of input ordering", () => {
    const input = base();
    input.streams[0].outcomes.push({ sourceRecordId: "b", state: "unsupported" });
    input.streams[0].observations.push({ sourceRecordId: "b", versionId: "vb" });
    input.streams[0].versions.push("vb");
    const reversed = { ...input, streams: [...input.streams].reverse().map((s) => ({ ...s, observations: [...s.observations].reverse(), outcomes: [...s.outcomes].reverse() })) };
    expect(reconcileActReplacement(input)).toEqual(reconcileActReplacement(reversed));
  });
});
