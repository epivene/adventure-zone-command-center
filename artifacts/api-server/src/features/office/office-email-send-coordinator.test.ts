import { describe, expect, it, vi } from "vitest";
import { OfficeEmailSendCoordinator } from "./office-email-send-coordinator";

const draftId = "11111111-1111-4111-8111-111111111111";
const sentAt = new Date("2026-10-01T15:00:00Z");

describe("OfficeEmailSendCoordinator", () => {
  it("sends and stores the finalized Early Bird body before recording enrollment", async () => {
    const sequence: string[] = [];
    const claimed = {
      id: draftId,
      officeAccountId: null,
      organizationId: "22222222-2222-4222-8222-222222222222",
      contactId: "33333333-3333-4333-8333-333333333333",
      bookingId: null,
      eventYear: 2027,
      recipientEmail: "person@example.com",
      subject: "Let’s plan your event",
      body: "Original body",
      templateCode: "met_at_convention",
      templateCategory: "convention",
    };
    const drafts = {
      claimForSend: vi.fn(async () => claimed),
      markSent: vi.fn(async (_id, input) => {
        sequence.push("stored");
        return { ...claimed, ...input, state: "sent" };
      }),
      restoreSubmittedAfterFailure: vi.fn(async () => undefined),
    };
    const delivery = {
      send: vi.fn(async (input) => {
        sequence.push("sent");
        expect(input.body).toContain("October 31, 2026");
        return { messageId: "smtp-message-1" };
      }),
    };
    const promotion = {
      prepareBody: vi.fn(async () => ({
        body: "Original body\n\nEarly Bird Promo: October 31, 2026",
        eligible: true,
        deadlineDate: "2026-10-31",
      })),
      recordConfirmedSend: vi.fn(async () => {
        sequence.push("promo-recorded");
        return null;
      }),
    };
    const coordinator = new OfficeEmailSendCoordinator({
      drafts,
      delivery,
      promotion,
      now: () => sentAt,
    } as any);

    const result = await coordinator.send({ draftId, overrides: {} });

    expect(drafts.markSent).toHaveBeenCalledWith(draftId, expect.objectContaining({
      body: expect.stringContaining("October 31, 2026"),
      messageId: "smtp-message-1",
      sentAt,
    }));
    expect(promotion.recordConfirmedSend).toHaveBeenCalledWith(expect.objectContaining({
      emailRecordId: draftId,
      sentAt,
      gmailMessageId: "smtp-message-1",
    }));
    expect(sequence).toEqual(["sent", "stored", "promo-recorded"]);
    expect(result.state).toBe("sent");
  });

  it("does not create an enrollment when delivery fails", async () => {
    const drafts = {
      claimForSend: vi.fn(async () => ({
        id: draftId, officeAccountId: null,
        organizationId: "22222222-2222-4222-8222-222222222222",
        contactId: "33333333-3333-4333-8333-333333333333",
        bookingId: null, eventYear: 2027, recipientEmail: "person@example.com",
        subject: "Subject", body: "Body", templateCode: "new_event_intro",
        templateCategory: "outreach",
      })),
      markSent: vi.fn(),
      restoreSubmittedAfterFailure: vi.fn(async () => undefined),
    };
    const promotion = {
      prepareBody: vi.fn(async () => ({ body: "Body", eligible: true, deadlineDate: "2026-10-31" })),
      recordConfirmedSend: vi.fn(),
    };
    const coordinator = new OfficeEmailSendCoordinator({
      drafts,
      delivery: { send: vi.fn(async () => { throw new Error("provider down"); }) },
      promotion,
      now: () => sentAt,
    } as any);

    await expect(coordinator.send({ draftId, overrides: {} })).rejects.toThrow("provider down");
    expect(drafts.markSent).not.toHaveBeenCalled();
    expect(promotion.recordConfirmedSend).not.toHaveBeenCalled();
    expect(drafts.restoreSubmittedAfterFailure).toHaveBeenCalledWith(draftId, "provider down");
  });

  it("secures the offer after a deposit-received email is confirmed sent", async () => {
    const claimed = {
      id: draftId,
      officeAccountId: null,
      organizationId: "22222222-2222-4222-8222-222222222222",
      contactId: "33333333-3333-4333-8333-333333333333",
      bookingId: null,
      eventYear: 2027,
      recipientEmail: "person@example.com",
      subject: "Deposit received",
      body: "Thank you for your deposit.",
      templateCode: "deposit_received",
      templateCategory: "transactional",
    };
    const promotion = {
      prepareBody: vi.fn(async () => ({ body: claimed.body, eligible: false, deadlineDate: null })),
      recordConfirmedSend: vi.fn(),
      recordDeposit: vi.fn(async () => null),
    };
    const coordinator = new OfficeEmailSendCoordinator({
      drafts: {
        claimForSend: vi.fn(async () => claimed),
        markSent: vi.fn(async () => ({ ...claimed, state: "sent" })),
        restoreSubmittedAfterFailure: vi.fn(async () => undefined),
      },
      delivery: { send: vi.fn(async () => ({ messageId: "smtp-message-2" })) },
      promotion,
      now: () => sentAt,
    });

    await coordinator.send({ draftId, overrides: {} });

    expect(promotion.recordDeposit).toHaveBeenCalledWith({
      organizationId: claimed.organizationId,
      eventYear: 2027,
      receivedAt: sentAt,
      source: "deposit_received_email",
    });
  });
});
