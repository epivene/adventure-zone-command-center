import { describe, expect, it, vi } from "vitest";

import { WebsiteAuditService } from "./website-audit-service";

const job = {
  id: "job-1",
  capability: "website_verification" as const,
  originalInstruction: "Check all websites",
  normalizedCommand: {},
  status: "queued" as const,
  stage: "queued",
  progress: { total: 0, processed: 0, verified: 0, broken: 0, mismatches: 0, review: 0, proposedFixes: 0, cursorAfterId: null },
  findings: [], proposals: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, failureMessage: null,
};

describe("WebsiteAuditService", () => {
  it("starts a read-only website audit immediately without confirmation", async () => {
    const repository = {
      createJob: vi.fn().mockResolvedValue("job-1"),
      getJob: vi.fn().mockResolvedValue(job),
    };
    const service = new WebsiteAuditService(repository as never);

    await expect(service.create({ actorId: "owner", instruction: "Check all websites" })).resolves.toMatchObject({
      id: "job-1",
      status: "queued",
      capability: "website_verification",
    });
    expect(repository.createJob).toHaveBeenCalledTimes(1);
  });
});
