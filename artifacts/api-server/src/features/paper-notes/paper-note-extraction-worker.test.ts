import { describe, expect, it, vi } from "vitest";

vi.mock("./paper-note-page-year-store", () => ({
  getPaperNotePageYear: vi.fn(async () => 2026),
  setPaperNotePageYear: vi.fn(async () => undefined),
}));

import {
  applyPaperNoteCallSheetDefaults,
  PaperNoteExtractionWorker,
  resolvePaperNotePageLastContactDate,
} from "./paper-note-extraction-worker";
import { PaperNoteProviderError } from "./paper-note-extraction-provider";
import type { PaperNoteExtraction, PaperNotePageSegmentation } from "./paper-note-extraction-schema";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

const segmentation: PaperNotePageSegmentation = {
  pageHeading: "Phone Calls April 22, 2026",
  pageActivityDate: "2026-04-22",
  pageContext: [],
  roughTranscription: "Example Fair\nSecond Festival",
  entries: [
    { sourceOrder: 0, region: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }, roughText: "Example Fair", mayContinue: false },
    { sourceOrder: 1, region: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 }, roughText: "Second Festival", mayContinue: false },
  ],
};

function extraction(name: string): PaperNoteExtraction {
  return {
    source: "provider",
    transcription: name,
    sourceRegion: null,
    mayContinue: false,
    event: { name, city: null, region: null, venue: null },
    eventDates: [],
    activity: { rawDateText: null, occurredOn: "2026-04-22", dateSource: "page_heading", method: "call", outcome: null, summary: null },
    contacts: [],
    organizationPhones: [],
    oldReminder: null,
    starredOnPaper: false,
    generalNotes: [],
    warnings: [],
  };
}

function setup() {
  const calls: string[] = [];
  const repository: any = {
    claimNextPage: vi.fn(async () => ({
      batchId,
      pageId,
      originalObjectKey: `paper-notes/${batchId}/${pageId}/original`,
      analysisObjectKey: null,
      declaredMimeType: "image/png",
      rotationDegrees: 90,
      attemptCount: 1,
      leaseToken: "lease-a",
      leaseExpiresAt: new Date("2026-08-20T20:05:00Z"),
    })),
    updateStage: vi.fn(async ({ stage }: any) => { calls.push(`stage:${stage}`); }),
    completePage: vi.fn(async () => { calls.push("complete"); }),
    failPage: vi.fn(async () => { calls.push("fail"); }),
  };
  const storage: any = {
    get: vi.fn(async () => { calls.push("get"); return new Uint8Array([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
      0,0,0,0,0x49,0x48,0x44,0x52,0,0,0,100,0,0,0,100,
    ]); }),
    putAnalysis: vi.fn(async () => { calls.push("analysis"); return `paper-notes/${batchId}/${pageId}/analysis`; }),
  };
  const provider: any = {
    segmentPage: vi.fn(async (input: any) => { calls.push(`segment:${input.rotationDegrees}`); return segmentation; }),
    extractEntry: vi.fn(async (input: any) => {
      calls.push(`entry:${input.entryHint.sourceOrder}:${input.entryHint.roughText}`);
      return extraction(input.entryHint.roughText);
    }),
  };
  return { calls, repository, storage, provider };
}

describe("paper call-sheet defaults", () => {
  it("resolves a month-day page heading with the selected paper year", () => {
    expect(resolvePaperNotePageLastContactDate(null, "June 3 -", 2026)).toBe("2026-06-03");
  });

  it("keeps a full parsed page date when one is already available", () => {
    expect(resolvePaperNotePageLastContactDate("2026-06-03", "June 3", 2026)).toBe("2026-06-03");
  });

  it("defaults a call-sheet entry to call when no completed alternate method is stated", () => {
    const value = extraction("4th of July - Enoch UT - Deborah Lay - 435-890-6349");
    value.activity.method = "unknown";
    expect(applyPaperNoteCallSheetDefaults(value).activity.method).toBe("call");
  });

  it("treats Send email as a future instruction while the historical contact stays a call", () => {
    const value = extraction("4th of July - Island Park ID - Send email");
    value.activity.method = "email";
    value.oldReminder = "Send email";
    expect(applyPaperNoteCallSheetDefaults(value).activity.method).toBe("call");
  });

  it("keeps a completed email as email", () => {
    const value = extraction("4th of July - Emailed Lakeside Lodge - no response");
    value.activity.method = "email";
    value.activity.outcome = "No response";
    expect(applyPaperNoteCallSheetDefaults(value).activity.method).toBe("email");
  });
});

describe("PaperNoteExtractionWorker", () => {
  it("processes one page in stages and targets each segmented entry", async () => {
    const { calls, repository, storage, provider } = setup();
    const worker = new PaperNoteExtractionWorker({ repository, storage, provider });

    const result = await worker.runOne({ workerId: "worker-a", now: new Date("2026-08-20T20:00:00Z") });

    expect(result).toEqual({ kind: "processed", pageId });
    expect(calls).toEqual([
      "get",
      "analysis",
      "stage:segment",
      "segment:90",
      "stage:extract_entries",
      "entry:0:Example Fair",
      "entry:1:Second Festival",
      "complete",
    ]);
    expect(repository.completePage).toHaveBeenCalledWith(expect.objectContaining({
      pageId,
      leaseToken: "lease-a",
      entries: [
        expect.objectContaining({ event: expect.objectContaining({ name: "Example Fair" }), sourceRegion: segmentation.entries[0]?.region }),
        expect.objectContaining({ event: expect.objectContaining({ name: "Second Festival" }), sourceRegion: segmentation.entries[1]?.region }),
      ],
    }));
    expect(storage.putAnalysis).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png" }));
  });

  it("marks a provider outage retryable instead of losing the page", async () => {
    const { repository, storage, provider } = setup();
    provider.segmentPage.mockRejectedValue(new PaperNoteProviderError("PROVIDER_UNAVAILABLE", "AI reading is unavailable right now."));
    const worker = new PaperNoteExtractionWorker({ repository, storage, provider });

    await expect(worker.runOne({ workerId: "worker-a", now: new Date("2026-08-20T20:00:00Z") }))
      .resolves.toEqual({ kind: "processed", pageId });
    expect(repository.failPage).toHaveBeenCalledWith(expect.objectContaining({
      pageId,
      leaseToken: "lease-a",
      errorCode: "PROVIDER_UNAVAILABLE",
      retryable: true,
    }));
  });

  it("returns idle without touching storage when there is no queued page", async () => {
    const { repository, storage, provider } = setup();
    repository.claimNextPage.mockResolvedValue(null);
    const worker = new PaperNoteExtractionWorker({ repository, storage, provider });

    await expect(worker.runOne({ workerId: "worker-a", now: new Date("2026-08-20T20:00:00Z") }))
      .resolves.toEqual({ kind: "idle" });
    expect(storage.get).not.toHaveBeenCalled();
    expect(provider.segmentPage).not.toHaveBeenCalled();
  });
});
