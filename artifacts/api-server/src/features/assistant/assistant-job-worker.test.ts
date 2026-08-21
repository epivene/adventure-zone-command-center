import { describe, expect, it, vi } from "vitest";

import { AssistantJobWorker } from "./assistant-job-worker";

function dependencies() {
  const jobRepository = {
    claimRunnable: vi.fn().mockResolvedValue({
      jobId: "job-1", actorId: "owner", capability: "website_verification",
      normalizedCommand: {}, status: "running", stage: "checking_websites", workerId: "worker-1",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    isCancellationRequested: vi.fn().mockResolvedValue(false),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    upsertFinding: vi.fn().mockResolvedValue(undefined),
    upsertProposal: vi.fn().mockResolvedValue(undefined),
    markComplete: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markStopped: vi.fn().mockResolvedValue(undefined),
  };
  const records = [
    { recordId: "a", label: "Idaho County Fair", website: "https://fair.example", city: "Cottonwood", region: "ID", phone: null, primaryEmailDomain: null },
    { recordId: "b", label: "Broken Fair", website: "https://broken.example", city: "Boise", region: "ID", phone: null, primaryEmailDomain: null },
  ];
  const recordRepository = {
    countApplicable: vi.fn().mockResolvedValue(records.length),
    listBatch: vi.fn().mockResolvedValueOnce(records).mockResolvedValueOnce([]),
  };
  const http = {
    inspect: vi.fn()
      .mockResolvedValueOnce({ requestedUrl: records[0]!.website, finalUrl: records[0]!.website, statusCode: 200, reachable: true, redirected: false, title: "Idaho County Fair Cottonwood", textSample: "Idaho County Fair Cottonwood ID", failure: null })
      .mockResolvedValueOnce({ requestedUrl: records[1]!.website, finalUrl: records[1]!.website, statusCode: null, reachable: false, redirected: false, title: null, textSample: "", failure: "timeout" }),
  };
  const replacement = {
    findOfficialReplacement: vi.fn()
      .mockResolvedValueOnce({ url: "https://official-broken-fair.example", confidence: "high", reasons: ["Official event identity matches."], sourceRefs: ["source"] }),
  };
  return { jobRepository, recordRepository, http, replacement };
}

describe("AssistantJobWorker", () => {
  it("processes a bounded website batch, persists findings, and proposes only high-confidence fixes", async () => {
    const deps = dependencies();
    const worker = new AssistantJobWorker(deps as never);

    await expect(worker.runOne({ workerId: "worker-1", now: new Date("2026-08-21T16:00:00Z") }))
      .resolves.toEqual({ kind: "worked" });

    expect(deps.recordRepository.listBatch).toHaveBeenCalledWith({ afterId: null, limit: 25 });
    expect(deps.jobRepository.upsertFinding).toHaveBeenCalledTimes(2);
    expect(deps.jobRepository.upsertProposal).toHaveBeenCalledTimes(1);
    expect(deps.jobRepository.updateProgress).toHaveBeenCalledWith("job-1", expect.objectContaining({
      total: 2,
      processed: 2,
      cursorAfterId: "b",
    }));
  });

  it("stops before network work when cancellation is requested", async () => {
    const deps = dependencies();
    deps.jobRepository.isCancellationRequested.mockResolvedValue(true);
    const worker = new AssistantJobWorker(deps as never);

    await worker.runOne({ workerId: "worker-1", now: new Date() });

    expect(deps.http.inspect).not.toHaveBeenCalled();
    expect(deps.jobRepository.markStopped).toHaveBeenCalledWith("job-1");
  });
});
