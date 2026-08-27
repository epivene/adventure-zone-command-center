import { describe, expect, it, vi } from "vitest";

import { OpportunityEmailActivityWriter } from "./opportunity-email-activity";

const OPPORTUNITY_ID = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000001";
const contactId = "30000000-0000-4000-8000-000000000001";
const bookingId = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-27T16:15:00.000Z");

function harness() {
  const opportunities = {
    get: vi.fn(async (id: string) => id === OPPORTUNITY_ID ? {
      id,
      organizationId,
      contactId,
      bookingId,
    } : null),
  };
  const activities = {
    create: vi.fn(async (input: unknown) => input),
  };
  return {
    opportunities,
    activities,
    writer: new OpportunityEmailActivityWriter({
      opportunities,
      activities,
      clock: { now: () => NOW },
    }),
  };
}

function expectActivity(
  create: ReturnType<typeof vi.fn>,
  body: string,
  occurredAt: Date = NOW,
) {
  expect(create).toHaveBeenLastCalledWith({
    organizationId,
    contactId,
    bookingId,
    kind: "note",
    body,
    occurredAt,
  });
}

describe("OpportunityEmailActivityWriter", () => {
  it("records draft creation and meaningful saved updates", async () => {
    const { writer, activities } = harness();

    await writer.recordDraftCreated({ opportunityId: OPPORTUNITY_ID, draftId: "draft-1", occurredAt: NOW });
    expectActivity(activities.create, "Email draft created.");

    await writer.recordDraftUpdated({ opportunityId: OPPORTUNITY_ID, draftId: "draft-1", occurredAt: NOW });
    expectActivity(activities.create, "Email draft updated.");
  });

  it("records scheduled, sent, and failed delivery milestones", async () => {
    const { writer, activities } = harness();
    const scheduledFor = new Date("2026-08-28T14:00:00.000Z");
    const sentAt = new Date("2026-08-28T14:00:05.000Z");

    await writer.recordScheduled({ opportunityId: OPPORTUNITY_ID, draftId: "draft-1", scheduledFor });
    expectActivity(activities.create, `Email scheduled for ${scheduledFor.toISOString()}.`, NOW);

    await writer.recordSent({
      opportunityId: OPPORTUNITY_ID,
      draftId: "draft-1",
      sentAt,
      messageId: "gmail-message-1",
      threadId: "gmail-thread-1",
    });
    expectActivity(activities.create, "Email sent.", sentAt);

    await writer.recordFailure({
      opportunityId: OPPORTUNITY_ID,
      draftId: "draft-1",
      operation: "send",
      code: "GMAIL_503",
      message: "Gmail temporarily unavailable",
      occurredAt: NOW,
    });
    expectActivity(activities.create, "Email send failed: Gmail temporarily unavailable.");
  });

  it("records blocker review and follow-up creation", async () => {
    const { writer, activities } = harness();
    const dueAt = new Date("2026-08-31T16:15:00.000Z");

    await writer.recordBlocker({
      opportunityId: OPPORTUNITY_ID,
      code: "territory_hold",
      message: "Territory approval is required.",
      occurredAt: NOW,
    });
    expectActivity(activities.create, "Email draft needs review: Territory approval is required.");

    await writer.recordFollowUpCreated({
      opportunityId: OPPORTUNITY_ID,
      followUpId: "follow-up-1",
      dueAt,
      occurredAt: NOW,
    });
    expectActivity(activities.create, `Email follow-up created for ${dueAt.toISOString()}.`);
  });

  it("does nothing when the Opportunity no longer exists", async () => {
    const { writer, opportunities, activities } = harness();
    opportunities.get.mockResolvedValueOnce(null);

    await writer.recordSent({
      opportunityId: OPPORTUNITY_ID,
      draftId: "draft-1",
      sentAt: NOW,
      messageId: "gmail-message-1",
      threadId: null,
    });

    expect(activities.create).not.toHaveBeenCalled();
  });
});
