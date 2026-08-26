import { describe, expect, it, vi } from "vitest";

import { createLeadEmailPreviewHandler } from "./lead-email-preview-handler";
import { LeadEmailPreviewRepositoryError } from "./lead-email-preview-repository";

function response() {
  const value: { statusCode: number; payload: unknown } = { statusCode: 200, payload: null };
  const api = {
    value,
    status: vi.fn((statusCode: number) => { value.statusCode = statusCode; return api; }),
    json: vi.fn((payload: unknown) => { value.payload = payload; return api; }),
  };
  return api;
}

describe("safe email preview route contract", () => {
  it("returns the sanitized preview DTO without raw snapshot fields", async () => {
    const preview = {
      sourceRowId: "30000000-0000-4000-8000-000000000001", rowVersion: 6, snapshotVersion: 6,
      verifiedDateRange: { startDate: "2026-09-29", endDate: "2026-10-04" }, recipient: "person@example.com",
      profileName: "Aspen Filmfest", eventName: "Aspen Filmfest", relationshipStatus: "new_introduction",
      territoryStatus: "open", fitStatus: "approved", templateStatus: "approved", templateVersion: "2026-prepaid-v1",
      templateSource: "ADVENTURE ZONE STICKY NOTES.docx.pdf", calendarEvidence: [], normalPackageCounts: [],
      calendarConflictSummary: { totalConflicts: 0, totalEvidenceRecords: 0, displayedEvidenceRecords: 0, truncated: false },
      readiness: { ready: false, blockers: ["availability_stale_for_lead_version"] }, subject: null, body: null,
    };
    const handler = createLeadEmailPreviewHandler({ preview: vi.fn().mockResolvedValue(preview) } as never);
    const res = response();

    await handler({ params: { rowId: preview.sourceRowId }, query: { expectedVersion: "6" }, log: { error: vi.fn() } } as never, res as never);

    expect(res.value.statusCode).toBe(200);
    expect(res.value.payload).toEqual({ preview });
    expect(JSON.stringify(res.value.payload)).not.toContain("sourceEvents");
    expect(JSON.stringify(res.value.payload)).not.toContain("reservations");
  });

  it("returns a structured 409 for an expected-version mismatch", async () => {
    const error = new LeadEmailPreviewRepositoryError("VERSION_CONFLICT", "Reload before previewing.", { expectedVersion: 5, currentVersion: 6 });
    const handler = createLeadEmailPreviewHandler({ preview: vi.fn().mockRejectedValue(error) } as never);
    const res = response();
    await handler({ params: { rowId: "30000000-0000-4000-8000-000000000001" }, query: { expectedVersion: "5" }, log: { error: vi.fn() } } as never, res as never);
    expect(res.value.statusCode).toBe(409);
    expect(res.value.payload).toEqual({ error: { code: "VERSION_CONFLICT", message: "Reload before previewing.", expectedVersion: 5, currentVersion: 6 } });
  });
});
