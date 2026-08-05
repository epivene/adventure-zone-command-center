import { describe, expect, it } from "vitest";
import {
  ACT_DISPLAY_AGGREGATES,
  ACT_REPORT_STREAMS,
  ReportValidationError,
  reportActReplacementImport,
  type ActReplacementReportInput,
} from "./report-act-replacement-import";

function fixture(): ActReplacementReportInput {
  const streams = ACT_REPORT_STREAMS.map((streamType) => ({
    streamType,
    counts: { linkedApplied: 1, alreadyPresent: 0, awaitingReview: 0, unassigned: 0, unsupported: 0, failed: 0, ready: 0 },
    archivedIdentities: 1,
    observedIdentities: 1,
    organizedCount: 1,
    issues: [],
  }));
  return {
    status: {
      runId: "run-1",
      phase: "complete",
      previewOnly: true,
      allStreams: { observedIdentities: 20, archivedIdentities: 20 },
    },
    review: { total: 0, rows: [], manifestDigest: "digest-1" },
    reconciliation: {
      runId: "run-1",
      sourceDatabaseKey: "db-redacted",
      phase: "complete",
      complete: true,
      finalizable: true,
      streams,
      allStreams: { linkedApplied: 20, alreadyPresent: 0, awaitingReview: 0, unassigned: 0, unsupported: 0, failed: 0, ready: 0, observedIdentities: 20, archivedIdentities: 20, organizedCount: 20 },
      rollups: ACT_DISPLAY_AGGREGATES.map((name) => ({ name, count: 0, informational: true as const })),
      issues: [],
      digest: "report-digest",
    },
  };
}

describe("Act replacement import report", () => {
  it("emits twenty stream rows, seven display aggregates, and an all-stream row without source values", () => {
    const result = reportActReplacementImport(fixture());
    const rows = result.csv.trim().split("\n");
    expect(rows).toHaveLength(1 + 20 + 7 + 1);
    expect(rows.some((row) => row.includes("company_contact"))).toBe(true);
    expect(rows.some((row) => row.includes("all-stream"))).toBe(true);
    expect(rows.some((row) => row.includes("organizations"))).toBe(true);
    expect(result.csv).not.toMatch(/raw|password|secret|token|authorization|body/i);
  });

  it("rejects equation mismatches and ready sources marked complete", () => {
    const input = fixture();
    input.reconciliation!.streams[0].counts.ready = 1;
    input.reconciliation!.streams[0].archivedIdentities = 1;
    input.reconciliation!.streams[0].counts.linkedApplied = 1;
    input.reconciliation!.complete = true;
    expect(() => reportActReplacementImport(input)).toThrow(ReportValidationError);
    expect(() => reportActReplacementImport(input)).toThrow(/identity equation|ready/i);
  });

  it("rejects a report that omits relationship streams", () => {
    const input = fixture();
    input.reconciliation!.streams = input.reconciliation!.streams.filter((row) => row.streamType !== "group_contact");
    expect(() => reportActReplacementImport(input)).toThrow(/missing relationship stream group_contact/);
  });

  it("never trusts review display or raw values for the CSV", () => {
    const input = fixture();
    input.review = { total: 1, manifestDigest: "digest-1", rows: [{ state: "applied", display: { name: "secret-name" }, raw: { password: "do-not-print" } }] };
    const result = reportActReplacementImport(input);
    expect(result.csv).not.toContain("secret-name");
    expect(result.csv).not.toContain("do-not-print");
  });
});
