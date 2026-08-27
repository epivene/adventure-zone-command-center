import { describe, expect, it, vi } from "vitest";

import { ScheduledEmailDispatcher } from "./scheduled-email-dispatcher";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const NOW = new Date("2026-08-28T14:00:00.000Z");
const DUE_AT = new Date("2026-08-28T13:55:00.000Z");

function scheduledDraft(): OpportunityEmailRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    opportunityId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    contactId: null,
    eventYear: 2026,
    purpose: "new_outreach",
    state: "scheduled",
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    subject: "Adventure Zone for Sample Fair",
    body: "Scheduled body",
    scheduledFor: DUE_AT,
    sentAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    sendRequestKey: null,
    scheduleRequestKey: "schedule-1",
    createdAt: new Date("2026-08-27T18:00:00.000Z"),
    updatedAt: new Date("2026-08-27T18:00:00.000Z"),
  };
}

describe("ScheduledEmailDispatcher", () => {
  it("claims one due scheduled draft and sends it with a deterministic request key", async () => {
    const draft = scheduledDraft();
    const store = {
      claimOneDue: vi.fn(async () => draft),
      releaseLease: vi.fn(async () => undefined),
    };
    const delivery = {
      sendDraft: vi.fn(async () => ({ draft: { ...draft, state: "sent" }, followUpReferenceAt: NOW })),
    };
    const dispatcher = new ScheduledEmailDispatcher({ store, delivery });

    const result = await dispatcher.runOne({ workerId: "scheduled-email-worker-1", now: NOW });

    expect(result).toEqual({ kind: "progress", draftId: draft.id });
    expect(store.claimOneDue).toHaveBeenCalledWith({ workerId: "scheduled-email-worker-1", now: NOW });
    expect(delivery.sendDraft).toHaveBeenCalledWith({
      opportunityId: draft.opportunityId,
      draftId: draft.id,
      requestKey: `scheduled-dispatch:${draft.id}:${DUE_AT.toISOString()}`,
    });
    expect(store.releaseLease).toHaveBeenCalledWith(draft.id, "scheduled-email-worker-1", NOW);
  });

  it("returns idle when no scheduled draft is due", async () => {
    const store = {
      claimOneDue: vi.fn(async () => null),
      releaseLease: vi.fn(async () => undefined),
    };
    const delivery = { sendDraft: vi.fn() };
    const dispatcher = new ScheduledEmailDispatcher({ store, delivery });

    await expect(dispatcher.runOne({ workerId: "worker-1", now: NOW })).resolves.toEqual({ kind: "idle" });
    expect(delivery.sendDraft).not.toHaveBeenCalled();
  });

  it("releases the lease after a durable send failure so another retry path can recover", async () => {
    const draft = scheduledDraft();
    const store = {
      claimOneDue: vi.fn(async () => draft),
      releaseLease: vi.fn(async () => undefined),
    };
    const delivery = {
      sendDraft: vi.fn(async () => { throw Object.assign(new Error("send failed"), { code: "GMAIL_SEND_FAILED" }); }),
    };
    const dispatcher = new ScheduledEmailDispatcher({ store, delivery });

    const result = await dispatcher.runOne({ workerId: "worker-1", now: NOW });

    expect(result).toEqual({ kind: "progress", draftId: draft.id });
    expect(store.releaseLease).toHaveBeenCalledWith(draft.id, "worker-1", NOW);
  });
});
