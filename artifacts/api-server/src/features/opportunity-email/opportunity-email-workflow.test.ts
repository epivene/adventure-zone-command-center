import { describe, expect, it, vi } from "vitest";

import { OpportunityEmailWorkflowCoordinator } from "./opportunity-email-workflow";

const opportunityId = "10000000-0000-4000-8000-000000000001";
const sentAt = new Date("2026-08-27T17:00:00.000Z");

function harness(status: string = "ready_to_contact") {
  const opportunity = {
    id: opportunityId,
    status,
  };
  const opportunities = {
    get: vi.fn(async () => opportunity as any),
    update: vi.fn(async (_id: string, patch: any) => ({ ...opportunity, ...patch })),
  };
  const activity = {
    recordDraftCreated: vi.fn(async () => undefined),
    recordDraftUpdated: vi.fn(async () => undefined),
    recordScheduled: vi.fn(async () => undefined),
    recordSent: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    recordBlocker: vi.fn(async () => undefined),
  };
  return {
    opportunities,
    activity,
    coordinator: new OpportunityEmailWorkflowCoordinator({ opportunities, activity }),
  };
}

describe("OpportunityEmailWorkflowCoordinator", () => {
  it("moves a material blocker to needs_review and records timeline activity", async () => {
    const { coordinator, opportunities, activity } = harness();
    const blocker = {
      code: "territory_hold" as const,
      message: "Territory approval is required.",
      requiresHumanReview: true as const,
    };

    await coordinator.record({ opportunityId, blocker });

    expect(opportunities.update).toHaveBeenCalledWith(opportunityId, {
      status: "needs_review",
      nextActionKind: "review_email_draft",
      nextActionDueAt: null,
      holdReason: blocker.message,
    });
    expect(activity.recordBlocker).toHaveBeenCalledWith({
      opportunityId,
      code: blocker.code,
      message: blocker.message,
    });
  });

  it("advances first successful outreach to contacted only after confirmed send", async () => {
    const { coordinator, opportunities, activity } = harness("ready_to_contact");

    await coordinator.recordSent({
      opportunityId,
      draftId: "draft-1",
      sentAt,
      messageId: "message-1",
      threadId: "thread-1",
    });

    expect(opportunities.update).toHaveBeenCalledWith(opportunityId, {
      status: "contacted",
      nextActionKind: null,
      nextActionDueAt: null,
      holdReason: null,
    });
    expect(activity.recordSent).toHaveBeenCalled();
  });

  it("does not regress an advanced Opportunity status after send", async () => {
    const { coordinator, opportunities } = harness("booking_in_progress");

    await coordinator.recordSent({
      opportunityId,
      draftId: "draft-1",
      sentAt,
      messageId: "message-1",
      threadId: null,
    });

    expect(opportunities.update).not.toHaveBeenCalled();
  });

  it("delegates draft, schedule, and failure activity without changing status", async () => {
    const { coordinator, opportunities, activity } = harness();
    const scheduledFor = new Date("2026-08-28T14:00:00.000Z");

    await coordinator.recordDraftCreated({ opportunityId, draftId: "draft-1" });
    await coordinator.recordDraftUpdated({ opportunityId, draftId: "draft-1" });
    await coordinator.recordScheduled({ opportunityId, draftId: "draft-1", scheduledFor });
    await coordinator.recordFailure({
      opportunityId,
      draftId: "draft-1",
      operation: "send",
      code: "GMAIL_503",
      message: "Gmail unavailable",
    });

    expect(activity.recordDraftCreated).toHaveBeenCalled();
    expect(activity.recordDraftUpdated).toHaveBeenCalled();
    expect(activity.recordScheduled).toHaveBeenCalled();
    expect(activity.recordFailure).toHaveBeenCalled();
    expect(opportunities.update).not.toHaveBeenCalled();
  });
});
