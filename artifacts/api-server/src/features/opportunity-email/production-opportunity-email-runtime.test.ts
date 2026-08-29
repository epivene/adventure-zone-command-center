import { describe, expect, it, vi } from "vitest";

import { assembleProductionOpportunityEmailRuntime } from "./production-opportunity-email-runtime";

const opportunityId = "11111111-1111-4111-8111-111111111111";

describe("assembleProductionOpportunityEmailRuntime", () => {
  it("shares one email service across draft routes, Ready to Send, and the dispatcher", async () => {
    const emailService = {
      createDraft: vi.fn(async () => ({ ok: false, blocker: { code: "missing_recipient", message: "missing", requiresHumanReview: true as const } })),
      saveDraft: vi.fn(),
      rewriteDraft: vi.fn(),
      sendDraft: vi.fn(),
      scheduleDraft: vi.fn(),
      retryDraft: vi.fn(),
    };
    const repository = {
      getCurrentForOpportunity: vi.fn(async () => null),
      getById: vi.fn(async () => null),
      listReadyToSend: vi.fn(async () => []),
      claimOneDue: vi.fn(async () => null),
      releaseLease: vi.fn(async () => undefined),
    };
    const readySource = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
    };

    const runtime = assembleProductionOpportunityEmailRuntime({
      emailService: emailService as any,
      repository: repository as any,
      readySource,
    });

    await runtime.drafts.createDraft({ opportunityId, purpose: "new_outreach" });
    expect(emailService.createDraft).toHaveBeenCalledWith({ opportunityId, purpose: "new_outreach" });

    await runtime.readyToSend.summary();
    expect(readySource.list).toHaveBeenCalledTimes(1);

    await runtime.dispatcher.runOne({
      workerId: "worker-1",
      now: new Date("2026-08-28T15:00:00.000Z"),
    });
    expect(repository.claimOneDue).toHaveBeenCalledTimes(1);
  });
});
