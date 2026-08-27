import { describe, expect, it, vi } from "vitest";

import { OpportunityEmailService } from "./opportunity-email-service";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const SENT_AT = new Date("2026-08-27T18:30:00.000Z");
const SCHEDULED_FOR = new Date("2026-08-28T14:00:00.000Z");

function record(overrides: Partial<OpportunityEmailRecord> = {}): OpportunityEmailRecord {
  const now = new Date("2026-08-27T18:00:00.000Z");
  return {
    id: DRAFT_ID,
    opportunityId: OPPORTUNITY_ID,
    organizationId: "22222222-2222-4222-8222-222222222222",
    contactId: "contact-1",
    eventYear: 2026,
    purpose: "new_outreach",
    state: "draft",
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    subject: "Adventure Zone for Sample County Fair",
    body: "Current edited body",
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

function dependencies(existing: OpportunityEmailRecord = record()) {
  const emailRepository = {
    getCurrentForOpportunity: vi.fn(async () => existing),
    getById: vi.fn(async () => existing),
    findBySendRequestKey: vi.fn(async (_key: string) => null as OpportunityEmailRecord | null),
    findByScheduleRequestKey: vi.fn(async (_key: string) => null as OpportunityEmailRecord | null),
    create: vi.fn(),
    update: vi.fn(async (_id: string, patch: Partial<OpportunityEmailRecord>) => record({ ...existing, ...patch })),
  };
  return {
    contextResolver: { resolve: vi.fn() },
    emailRepository,
    draftGenerator: { generate: vi.fn() },
    gmailDraftProvider: {
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      sendDraft: vi.fn(async () => ({ messageId: "gmail-sent-1", threadId: "thread-1", sentAt: SENT_AT })),
      scheduleDraft: vi.fn(async () => ({ scheduledFor: SCHEDULED_FOR })),
      reconcileSend: vi.fn(async () => null),
    },
    blockerSink: { record: vi.fn() },
    workflowSink: {
      recordSent: vi.fn(async () => undefined),
      recordScheduled: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => undefined),
    },
  };
}

describe("OpportunityEmailService delivery", () => {
  it("marks sent and advances workflow only after Gmail confirms send", async () => {
    const deps = dependencies();
    const service = new OpportunityEmailService(deps as any);

    const result = await service.sendDraft({ opportunityId: OPPORTUNITY_ID, draftId: DRAFT_ID, requestKey: "send-1" });

    expect(deps.gmailDraftProvider.sendDraft).toHaveBeenCalledWith({ draftId: "gmail-draft-1" });
    expect(deps.emailRepository.update).toHaveBeenCalledWith(DRAFT_ID, expect.objectContaining({
      state: "sent",
      sentAt: SENT_AT,
      sendRequestKey: "send-1",
      gmailMessageId: "gmail-sent-1",
      gmailThreadId: "thread-1",
    }));
    expect(deps.workflowSink.recordSent).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      sentAt: SENT_AT,
    }));
    expect(result.followUpReferenceAt).toEqual(SENT_AT);
  });

  it("records scheduled state without pretending the email has been sent", async () => {
    const deps = dependencies();
    const service = new OpportunityEmailService(deps as any);

    const result = await service.scheduleDraft({ opportunityId: OPPORTUNITY_ID, draftId: DRAFT_ID, requestKey: "schedule-1", scheduledFor: SCHEDULED_FOR });

    expect(deps.gmailDraftProvider.scheduleDraft).toHaveBeenCalledWith({ draftId: "gmail-draft-1", scheduledFor: SCHEDULED_FOR });
    expect(deps.emailRepository.update).toHaveBeenCalledWith(DRAFT_ID, expect.objectContaining({
      state: "scheduled",
      scheduledFor: SCHEDULED_FOR,
      scheduleRequestKey: "schedule-1",
      sentAt: null,
    }));
    expect(deps.workflowSink.recordScheduled).toHaveBeenCalled();
    expect(deps.workflowSink.recordSent).not.toHaveBeenCalled();
    expect(result.followUpReferenceAt).toEqual(SCHEDULED_FOR);
  });

  it("preserves the draft and records failure without advancing workflow", async () => {
    const deps = dependencies();
    deps.gmailDraftProvider.sendDraft.mockRejectedValueOnce(Object.assign(new Error("provider down"), { code: "GMAIL_SEND_FAILED" }));
    const service = new OpportunityEmailService(deps as any);

    await expect(service.sendDraft({ opportunityId: OPPORTUNITY_ID, draftId: DRAFT_ID, requestKey: "send-fail" })).rejects.toThrow("GMAIL_SEND_FAILED");

    expect(deps.emailRepository.update).toHaveBeenCalledWith(DRAFT_ID, expect.objectContaining({
      state: "failed",
      lastFailureCode: "GMAIL_SEND_FAILED",
      sendRequestKey: "send-fail",
    }));
    expect(deps.workflowSink.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: OPPORTUNITY_ID, draftId: DRAFT_ID }));
    expect(deps.workflowSink.recordSent).not.toHaveBeenCalled();
  });

  it("reuses a prior confirmed send for the same request key", async () => {
    const prior = record({ state: "sent", sentAt: SENT_AT, sendRequestKey: "same-send" });
    const deps = dependencies(prior);
    deps.emailRepository.findBySendRequestKey.mockResolvedValueOnce(prior);
    const service = new OpportunityEmailService(deps as any);

    const result = await service.sendDraft({ opportunityId: OPPORTUNITY_ID, draftId: DRAFT_ID, requestKey: "same-send" });

    expect(deps.gmailDraftProvider.sendDraft).not.toHaveBeenCalled();
    expect(result.draft).toBe(prior);
    expect(result.followUpReferenceAt).toEqual(SENT_AT);
  });

  it("reconciles an uncertain send before allowing retry so it does not send twice", async () => {
    const deps = dependencies();
    deps.gmailDraftProvider.sendDraft.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "GMAIL_SEND_OUTCOME_UNCERTAIN" }));
    deps.gmailDraftProvider.reconcileSend.mockResolvedValueOnce({ messageId: "gmail-sent-2", threadId: "thread-2", sentAt: SENT_AT });
    const service = new OpportunityEmailService(deps as any);

    const result = await service.sendDraft({ opportunityId: OPPORTUNITY_ID, draftId: DRAFT_ID, requestKey: "uncertain-1" });

    expect(deps.gmailDraftProvider.sendDraft).toHaveBeenCalledTimes(1);
    expect(deps.gmailDraftProvider.reconcileSend).toHaveBeenCalledWith({ draftId: "gmail-draft-1" });
    expect(deps.workflowSink.recordSent).toHaveBeenCalledTimes(1);
    expect(result.followUpReferenceAt).toEqual(SENT_AT);
  });
});
