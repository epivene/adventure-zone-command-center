import { describe, expect, it, vi } from "vitest";

import { createOpportunityEmailRuntime } from "./opportunity-email-runtime";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const opportunityId = "10000000-0000-4000-8000-000000000001";
const draftId = "30000000-0000-4000-8000-000000000001";

function draft(overrides: Partial<OpportunityEmailRecord> = {}): OpportunityEmailRecord {
  const now = new Date("2026-08-27T18:00:00.000Z");
  return {
    id: draftId,
    opportunityId,
    organizationId: "20000000-0000-4000-8000-000000000001",
    contactId: null,
    eventYear: 2026,
    purpose: "new_outreach",
    state: "draft",
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "fair@example.com",
    recipientName: "Casey",
    subject: "Sample subject",
    body: "Sample body",
    scheduledFor: null,
    sentAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    sendRequestKey: null,
    scheduleRequestKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function harness() {
  const current = draft();
  const emailService = {
    createDraft: vi.fn(async () => ({ ok: true as const, draft: current })),
    saveDraft: vi.fn(async () => current),
    rewriteDraft: vi.fn(async () => ({ draft: current, undoSubject: current.subject, undoBody: current.body })),
    sendDraft: vi.fn(async () => ({ draft: { ...current, state: "sent" as const }, followUpReferenceAt: new Date("2026-08-27T18:30:00.000Z") })),
    scheduleDraft: vi.fn(async () => ({ draft: { ...current, state: "scheduled" as const }, followUpReferenceAt: new Date("2026-08-28T14:00:00.000Z") })),
    retryDraft: vi.fn(async () => ({ draft: current, followUpReferenceAt: null })),
  };
  const repository = {
    getCurrentForOpportunity: vi.fn(async () => current),
    getById: vi.fn(async () => current),
    listReadyToSend: vi.fn(async () => [current]),
    claimOneDue: vi.fn(async () => null as OpportunityEmailRecord | null),
    releaseLease: vi.fn(async () => undefined),
  };
  const readySource = {
    list: vi.fn(async () => [{
      draft: current,
      eventName: "Sample Fair",
      opportunityStatus: "ready_to_contact",
      ownerVisible: true,
      blocked: false,
      warning: null,
    }]),
    get: vi.fn(async () => ({
      draft: current,
      eventName: "Sample Fair",
      opportunityStatus: "ready_to_contact",
      ownerVisible: true,
      blocked: false,
      warning: null,
    })),
  };
  return { emailService, repository, readySource };
}

describe("createOpportunityEmailRuntime", () => {
  it("exposes current draft lookup alongside the shared email service", async () => {
    const deps = harness();
    const runtime = createOpportunityEmailRuntime(deps as any);

    const current = await runtime.drafts.getDraft(opportunityId);

    expect(current?.id).toBe(draftId);
    expect(deps.repository.getCurrentForOpportunity).toHaveBeenCalledWith(opportunityId);
  });

  it("uses the same email service for Today bulk send", async () => {
    const deps = harness();
    const runtime = createOpportunityEmailRuntime(deps as any);

    const results = await runtime.readyToSend.sendSelected([{ draftId, opportunityId, requestKey: "send-1" }]);

    expect(results).toEqual([{ draftId, ok: true }]);
    expect(deps.emailService.sendDraft).toHaveBeenCalledWith({ draftId, opportunityId, requestKey: "send-1" });
  });

  it("uses the same email service when the scheduled dispatcher claims due work", async () => {
    const deps = harness();
    const scheduled = draft({ state: "scheduled", scheduledFor: new Date("2026-08-27T17:00:00.000Z") });
    deps.repository.claimOneDue.mockResolvedValueOnce(scheduled);
    const runtime = createOpportunityEmailRuntime(deps as any);

    const result = await runtime.dispatcher.runOne({ workerId: "worker-1", now: new Date("2026-08-27T18:00:00.000Z") });

    expect(result).toEqual({ kind: "progress", draftId });
    expect(deps.emailService.sendDraft).toHaveBeenCalledWith({
      opportunityId,
      draftId,
      requestKey: `scheduled-dispatch:${draftId}:2026-08-27T17:00:00.000Z`,
    });
    expect(deps.repository.releaseLease).toHaveBeenCalledWith(draftId, "worker-1", new Date("2026-08-27T18:00:00.000Z"));
  });
});
