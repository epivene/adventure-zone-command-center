import type { DraftBlocker } from "./draft-guardrails";

type OpportunityRecord = {
  id: string;
  status: string;
};

type OpportunityStore = {
  get(id: string): Promise<OpportunityRecord | null>;
  update(id: string, patch: {
    status?: "needs_review" | "contacted";
    nextActionKind?: string | null;
    nextActionDueAt?: Date | null;
    holdReason?: string | null;
  }): Promise<unknown>;
};

type OpportunityEmailActivity = {
  recordDraftCreated(input: { opportunityId: string; draftId: string }): Promise<void>;
  recordDraftUpdated(input: { opportunityId: string; draftId: string }): Promise<void>;
  recordScheduled(input: { opportunityId: string; draftId: string; scheduledFor: Date }): Promise<void>;
  recordSent(input: {
    opportunityId: string;
    draftId: string;
    sentAt: Date;
    messageId: string;
    threadId: string | null;
  }): Promise<void>;
  recordFailure(input: {
    opportunityId: string;
    draftId: string;
    operation: "send" | "schedule";
    code: string;
    message: string;
  }): Promise<void>;
  recordBlocker(input: {
    opportunityId: string;
    code: string;
    message: string;
  }): Promise<void>;
};

export class OpportunityEmailWorkflowCoordinator {
  constructor(private readonly deps: {
    opportunities: OpportunityStore;
    activity: OpportunityEmailActivity;
  }) {}

  async record(input: { opportunityId: string; blocker: DraftBlocker }): Promise<void> {
    await this.deps.opportunities.update(input.opportunityId, {
      status: "needs_review",
      nextActionKind: "review_email_draft",
      nextActionDueAt: null,
      holdReason: input.blocker.message,
    });
    await this.deps.activity.recordBlocker({
      opportunityId: input.opportunityId,
      code: input.blocker.code,
      message: input.blocker.message,
    });
  }

  async recordDraftCreated(input: { opportunityId: string; draftId: string }): Promise<void> {
    await this.deps.activity.recordDraftCreated(input);
  }

  async recordDraftUpdated(input: { opportunityId: string; draftId: string }): Promise<void> {
    await this.deps.activity.recordDraftUpdated(input);
  }

  async recordScheduled(input: {
    opportunityId: string;
    draftId: string;
    scheduledFor: Date;
  }): Promise<void> {
    await this.deps.activity.recordScheduled(input);
  }

  async recordSent(input: {
    opportunityId: string;
    draftId: string;
    sentAt: Date;
    messageId: string;
    threadId: string | null;
  }): Promise<void> {
    const opportunity = await this.deps.opportunities.get(input.opportunityId);
    if (opportunity?.status === "ready_to_contact") {
      await this.deps.opportunities.update(input.opportunityId, {
        status: "contacted",
        nextActionKind: null,
        nextActionDueAt: null,
        holdReason: null,
      });
    }
    await this.deps.activity.recordSent(input);
  }

  async recordFailure(input: {
    opportunityId: string;
    draftId: string;
    operation: "send" | "schedule";
    code: string;
    message: string;
  }): Promise<void> {
    await this.deps.activity.recordFailure(input);
  }
}
