import type { OpportunityEmailRecord } from "./opportunity-email-types";

export type ScheduledEmailDispatchResult =
  | { kind: "idle" }
  | { kind: "progress"; draftId: string };

export type ScheduledEmailDispatchStore = {
  claimOneDue(input: {
    workerId: string;
    now: Date;
  }): Promise<OpportunityEmailRecord | null>;
  releaseLease(draftId: string, workerId: string, now: Date): Promise<void>;
};

export type ScheduledEmailDispatchDelivery = {
  sendDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
  }): Promise<unknown>;
};

function requestKey(draft: OpportunityEmailRecord): string {
  if (!draft.scheduledFor) {
    throw Object.assign(new Error("SCHEDULED_EMAIL_DISPATCH_TIMESTAMP_MISSING"), {
      code: "SCHEDULED_EMAIL_DISPATCH_TIMESTAMP_MISSING",
    });
  }
  return `scheduled-dispatch:${draft.id}:${draft.scheduledFor.toISOString()}`;
}

export class ScheduledEmailDispatcher {
  constructor(private readonly dependencies: {
    store: ScheduledEmailDispatchStore;
    delivery: ScheduledEmailDispatchDelivery;
  }) {}

  async runOne(input: {
    workerId: string;
    now: Date;
  }): Promise<ScheduledEmailDispatchResult> {
    const draft = await this.dependencies.store.claimOneDue(input);
    if (!draft) return { kind: "idle" };

    try {
      await this.dependencies.delivery.sendDraft({
        opportunityId: draft.opportunityId,
        draftId: draft.id,
        requestKey: requestKey(draft),
      });
    } catch {
      // Delivery failures are made durable by OpportunityEmailService. The dispatcher
      // releases its lease so the row is never stranded by a process-local claim.
    } finally {
      await this.dependencies.store.releaseLease(draft.id, input.workerId, input.now);
    }

    return { kind: "progress", draftId: draft.id };
  }
}
