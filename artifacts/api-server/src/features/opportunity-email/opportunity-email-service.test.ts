import { describe, expect, it, vi } from "vitest";

import { OpportunityEmailService } from "./opportunity-email-service";
import type { DraftContext } from "./draft-context-resolver";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";

function context(overrides: Partial<DraftContext> = {}): DraftContext {
  return {
    opportunityId: OPPORTUNITY_ID,
    organizationId: ORGANIZATION_ID,
    eventYear: 2026,
    eventName: "Sample County Fair",
    city: "Sample City",
    region: "CO",
    startsAt: new Date("2026-09-10T15:00:00.000Z"),
    endsAt: new Date("2026-09-12T23:00:00.000Z"),
    contactId: "contact-1",
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    recipientAmbiguous: false,
    priorRelationshipSummary: ["Gmail: organizer asked for updated details"],
    sameYearSentCount: 0,
    sameYearDeclined: false,
    existingDraftId: null,
    calendarEvidence: [{}],
    packageAvailability: { adventureZone: "available" },
    protectedRecord: false,
    territoryExceptionApproved: false,
    ...overrides,
  };
}

function record(overrides: Partial<OpportunityEmailRecord> = {}): OpportunityEmailRecord {
  const now = new Date("2026-08-27T18:00:00.000Z");
  return {
    id: DRAFT_ID,
    opportunityId: OPPORTUNITY_ID,
    organizationId: ORGANIZATION_ID,
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
    body: "Generated body",
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

function deps(existing: OpportunityEmailRecord | null = null, resolvedContext = context()) {
  const emailRepository = {
    getCurrentForOpportunity: vi.fn(async () => existing),
    getById: vi.fn(async () => existing),
    create: vi.fn(async (input: any) => record(input)),
    update: vi.fn(async (_id: string, patch: any) => record({ ...(existing ?? {}), ...patch })),
  };
  return {
    contextResolver: { resolve: vi.fn(async () => resolvedContext) },
    emailRepository,
    draftGenerator: {
      generate: vi.fn(async () => ({
        subject: "Adventure Zone for Sample County Fair",
        body: "Generated body",
      })),
    },
    gmailDraftProvider: {
      createDraft: vi.fn(async () => ({ draftId: "gmail-draft-1", messageId: "gmail-message-1", threadId: null })),
      updateDraft: vi.fn(async () => ({ draftId: "gmail-draft-1", messageId: "gmail-message-2", threadId: "thread-1" })),
      sendDraft: vi.fn(async () => ({
        messageId: "gmail-message-3",
        threadId: "thread-1",
        sentAt: new Date("2026-08-27T18:00:00.000Z"),
      })),
    },
    blockerSink: { record: vi.fn(async () => undefined) },
    workflowSink: {
      recordDraftCreated: vi.fn(async () => undefined),
      recordDraftUpdated: vi.fn(async () => undefined),
      recordSent: vi.fn(async () => undefined),
      recordScheduled: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => undefined),
    },
  };
}

describe("OpportunityEmailService", () => {
  it("sends an existing draft and records confirmed delivery without calling a model",async()=>{
    const dependencies=deps(record());
    const result=await new OpportunityEmailService(dependencies).sendDraft({opportunityId:OPPORTUNITY_ID,draftId:DRAFT_ID,requestKey:"send-existing"});
    expect(result.draft.state).toBe("sent");
    expect(dependencies.gmailDraftProvider.sendDraft).toHaveBeenCalledTimes(1);
    expect(dependencies.draftGenerator.generate).not.toHaveBeenCalled();
    expect(dependencies.workflowSink.recordSent).toHaveBeenCalledWith(expect.objectContaining({opportunityId:OPPORTUNITY_ID,draftId:DRAFT_ID,messageId:"gmail-message-3"}));
  });
  it("generates and creates a Gmail draft only when createDraft is explicitly called", async () => {
    const dependencies = deps();
    const service = new OpportunityEmailService(dependencies);

    expect(dependencies.draftGenerator.generate).not.toHaveBeenCalled();
    expect(dependencies.gmailDraftProvider.createDraft).not.toHaveBeenCalled();

    const result = await service.createDraft({ opportunityId: OPPORTUNITY_ID, purpose: "new_outreach" });

    expect(result.ok).toBe(true);
    expect(dependencies.draftGenerator.generate).toHaveBeenCalledTimes(1);
    expect(dependencies.gmailDraftProvider.createDraft).toHaveBeenCalledWith({
      to: "booking@example.com",
      subject: "Adventure Zone for Sample County Fair",
      body: "Generated body",
    });
    expect(dependencies.emailRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId: OPPORTUNITY_ID,
      gmailDraftId: "gmail-draft-1",
      gmailMessageId: "gmail-message-1",
      purpose: "new_outreach",
    }));
    expect(dependencies.workflowSink.recordDraftCreated).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
    });
  });

  it("reopens the existing current draft without generating, duplicating, or recording a new creation", async () => {
    const existing = record();
    const dependencies = deps(existing, context({ existingDraftId: existing.id }));
    const service = new OpportunityEmailService(dependencies);

    const result = await service.createDraft({ opportunityId: OPPORTUNITY_ID, purpose: "new_outreach" });

    expect(result).toEqual({ ok: true, draft: existing });
    expect(dependencies.draftGenerator.generate).not.toHaveBeenCalled();
    expect(dependencies.gmailDraftProvider.createDraft).not.toHaveBeenCalled();
    expect(dependencies.emailRepository.create).not.toHaveBeenCalled();
    expect(dependencies.workflowSink.recordDraftCreated).not.toHaveBeenCalled();
  });

  it("records a material guardrail blocker and never creates Gmail content", async () => {
    const dependencies = deps(null, context({ region: "TX" }));
    const service = new OpportunityEmailService(dependencies);

    const result = await service.createDraft({ opportunityId: OPPORTUNITY_ID, purpose: "new_outreach" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected blocker");
    expect(result.blocker.code).toBe("territory_hold");
    expect(dependencies.blockerSink.record).toHaveBeenCalledWith({ opportunityId: OPPORTUNITY_ID, blocker: result.blocker });
    expect(dependencies.draftGenerator.generate).not.toHaveBeenCalled();
    expect(dependencies.gmailDraftProvider.createDraft).not.toHaveBeenCalled();
  });

  it("uses follow-up purpose when current-year outreach already exists", async () => {
    const dependencies = deps(null, context({ sameYearSentCount: 1 }));
    const service = new OpportunityEmailService(dependencies);

    const result = await service.createDraft({ opportunityId: OPPORTUNITY_ID, purpose: "new_outreach" });

    expect(result.ok).toBe(true);
    expect(dependencies.draftGenerator.generate).toHaveBeenCalledWith(expect.objectContaining({ purpose: "follow_up" }));
    expect(dependencies.emailRepository.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: "follow_up" }));
  });

  it("never invokes Gmail for a legacy draft with a note-like recipient", async () => {
    const existing = record({ recipientEmail: "use the website contact form" });
    const dependencies = deps(existing);
    const service = new OpportunityEmailService(dependencies);

    await expect(service.sendDraft({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      requestKey: "44444444-4444-4444-8444-444444444444",
    })).rejects.toMatchObject({code:"OPPORTUNITY_EMAIL_RECIPIENT_NOT_SENDABLE"});

    expect(dependencies.gmailDraftProvider.sendDraft).not.toHaveBeenCalled();
  });

  it("saves manual edits to the same Gmail draft and records one meaningful update without creating a follow-up", async () => {
    const existing = record();
    const dependencies = deps(existing);
    const service = new OpportunityEmailService(dependencies);

    const saved = await service.saveDraft({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      subject: "Edited subject",
      body: "Edited body",
    });

    expect(dependencies.gmailDraftProvider.updateDraft).toHaveBeenCalledWith({
      draftId: "gmail-draft-1",
      to: existing.recipientEmail,
      subject: "Edited subject",
      body: "Edited body",
    });
    expect(dependencies.emailRepository.update).toHaveBeenCalledWith(DRAFT_ID, expect.objectContaining({
      subject: "Edited subject",
      body: "Edited body",
      gmailMessageId: "gmail-message-2",
      gmailThreadId: "thread-1",
      state: "draft",
    }));
    expect(dependencies.workflowSink.recordDraftUpdated).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
    });
    expect(saved.subject).toBe("Edited subject");
  });

  it("rejects saving a draft that belongs to another opportunity", async () => {
    const existing = record({ opportunityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const dependencies = deps(existing);
    const service = new OpportunityEmailService(dependencies);

    await expect(service.saveDraft({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      subject: "Edited subject",
      body: "Edited body",
    })).rejects.toThrow("OPPORTUNITY_EMAIL_DRAFT_MISMATCH");

    expect(dependencies.gmailDraftProvider.updateDraft).not.toHaveBeenCalled();
    expect(dependencies.workflowSink.recordDraftUpdated).not.toHaveBeenCalled();
  });
});

