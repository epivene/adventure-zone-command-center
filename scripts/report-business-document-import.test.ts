import { describe, expect, it } from "vitest";
import { businessDocumentReportExitCode, formatBusinessDocumentReport, parseReportArgs } from "./report-business-document-import";

const report = { runId: "run-1", sourceKind: "gmail", mode: "pilot", status: "completed", discovered: 5, imported: 2, deduplicated: 1, review: 1, skipped: 1, retry: 0, failed: 0, linked: 2, unaccounted: 0, reconciled: true, errorCodes: ["GMAIL_IMPORT_FAILED"] } as const;
describe("business document import report", () => {
  it("requires --run-id and emits JSON plus a human-readable table", () => {
    expect(parseReportArgs(["--run-id=run-1"])).toEqual({ runId: "run-1", jsonOnly: false });
    const output = formatBusinessDocumentReport(report);
    expect(output).toContain('"reconciled": true');
    expect(output).toContain("discovered");
    expect(output).not.toMatch(/filename|storageKey|storage.googleapis.com/i);
  });
  it("rejects a missing run id", () => expect(() => parseReportArgs([])).toThrow(/run-id/));
  it("exits nonzero when counts do not reconcile", () => expect(businessDocumentReportExitCode({ reconciled: false })).toBe(1));
});
