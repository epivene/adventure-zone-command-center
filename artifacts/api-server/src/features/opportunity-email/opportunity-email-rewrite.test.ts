import { describe, expect, it, vi } from "vitest";

import { OpportunityEmailService, type DraftRewriteAction } from "./opportunity-email-service";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const ACTIONS: DraftRewriteAction[] = [
  "shorter",
  "more_casual",
  "more_direct",
  "rewrite_opening",
  "more_personal",
  "stronger_follow_up",
  "fix_wording",
];

function record(overrides: Partial<OpportunityEmailRecord> = {}): OpportunityEmailRecord {
  const now = new Date("2026-08-27T18:00:00.000Z");
  return {
    id: DRAFT_ID,
    opportunityId: OPPORTUNITY_ID,
    organizationId: "22222222-2222-4222-8222-222222222222",
    contactId: "contact-1",
    eventYear: 2026,
    purpose: "follow_up",
    state: "draft",
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: "thread-1",
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    subject: "Stored subject",
    body: "Stored body",
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

function dependencies(existing = record()) {
  const rewriteAdapter = {
    rewrite: vi.fn(async (input: any) => ({
      subject: `${input.subject} revised`,
      body: input.action === "rewrite_opening"
        ? `New opening.\n\nSecond paragraph stays.\n\nThird paragraph stays.`
        : `${input.body} revised`,
    })),
  };
  const emailRepository = {
    getCurrentForOpportunity: vi.fn(async () => existing),
    getById: vi.fn(async () => existing),
    create: vi.fn(async () => existing),
    update: vi.fn(async (_id: string, patch: any) => record({ ...existing, ...patch })),
  };
  return {
    contextResolver: { resolve: vi.fn() },
    emailRepository,
    draftGenerator: { generate: vi.fn() },
    gmailDraftProvider: {
      createDraft: vi.fn(),
      updateDraft: vi.fn(async () => ({ draftId: "gmail-draft-1", messageId: "gmail-message-2", threadId: "thread-1" })),
    },
    blockerSink: { record: vi.fn() },
    rewriteAdapter,
  };
}

describe("OpportunityEmailService rewriteDraft", () => {
  it.each(ACTIONS)("passes current user-edited content to %s rewrite", async (action) => {
    const deps = dependencies();
    const service = new OpportunityEmailService(deps);

    const result = await service.rewriteDraft({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      action,
      subject: "User edited subject",
      body: "User edited body",
    });

    expect(deps.rewriteAdapter.rewrite).toHaveBeenCalledWith({
      action,
      subject: "User edited subject",
      body: "User edited body",
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      purpose: "follow_up",
    });
    expect(result.undoSubject).toBe("User edited subject");
    expect(result.undoBody).toBe("User edited body");
    expect(deps.gmailDraftProvider.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "gmail-draft-1",
      subject: expect.stringContaining("revised"),
    }));
  });

  it("preserves unrelated paragraphs for Rewrite Opening", async () => {
    const existing = record();
    const deps = dependencies(existing);
    deps.rewriteAdapter.rewrite.mockResolvedValue({
      subject: "Same subject",
      body: "New relationship-aware opening.\n\nSecond paragraph stays.\n\nThird paragraph stays.",
    });
    const service = new OpportunityEmailService(deps);
    const currentBody = "Old opening.\n\nSecond paragraph stays.\n\nThird paragraph stays.";

    const result = await service.rewriteDraft({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      action: "rewrite_opening",
      subject: "Same subject",
      body: currentBody,
    });

    expect(result.draft.body.split("\n\n").slice(1)).toEqual([
      "Second paragraph stays.",
      "Third paragraph stays.",
    ]);
    expect(result.undoBody).toBe(currentBody);
  });

  it("rejects rewrite when draft ownership does not match", async () => {
    const deps = dependencies(record({ opportunityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    const service = new OpportunityEmailService(deps);

    await expect(service.rewriteDraft({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      action: "shorter",
      subject: "Subject",
      body: "Body",
    })).rejects.toThrow("OPPORTUNITY_EMAIL_DRAFT_MISMATCH");

    expect(deps.rewriteAdapter.rewrite).not.toHaveBeenCalled();
  });
});
