import type { CreateActivityInput } from "@/features/activities/activity-types";

type OpportunityContext = {
  id: string;
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
};

type OpportunityReader = {
  get(id: string): Promise<OpportunityContext | null>;
};

type ActivityWriter = {
  create(input: CreateActivityInput): Promise<unknown>;
};

type Clock = { now(): Date };

type BaseInput = {
  opportunityId: string;
};

export class OpportunityEmailActivityWriter {
  private readonly clock: Clock;

  constructor(private readonly deps: {
    opportunities: OpportunityReader;
    activities: ActivityWriter;
    clock?: Clock;
  }) {
    this.clock = deps.clock ?? { now: () => new Date() };
  }

  async recordDraftCreated(input: BaseInput & { draftId: string; occurredAt?: Date }): Promise<void> {
    await this.write(input.opportunityId, "Email draft created.", input.occurredAt ?? this.clock.now());
  }

  async recordDraftUpdated(input: BaseInput & { draftId: string; occurredAt?: Date }): Promise<void> {
    await this.write(input.opportunityId, "Email draft updated.", input.occurredAt ?? this.clock.now());
  }

  async recordScheduled(input: BaseInput & { draftId: string; scheduledFor: Date }): Promise<void> {
    await this.write(
      input.opportunityId,
      `Email scheduled for ${input.scheduledFor.toISOString()}.`,
      this.clock.now(),
    );
  }

  async recordSent(input: BaseInput & {
    draftId: string;
    sentAt: Date;
    messageId: string;
    threadId: string | null;
  }): Promise<void> {
    await this.write(input.opportunityId, "Email sent.", input.sentAt);
  }

  async recordFailure(input: BaseInput & {
    draftId: string;
    operation: "send" | "schedule";
    code: string;
    message: string;
    occurredAt?: Date;
  }): Promise<void> {
    await this.write(
      input.opportunityId,
      `Email ${input.operation} failed: ${input.message}.`,
      input.occurredAt ?? this.clock.now(),
    );
  }

  async recordBlocker(input: BaseInput & {
    code: string;
    message: string;
    occurredAt?: Date;
  }): Promise<void> {
    await this.write(
      input.opportunityId,
      `Email draft needs review: ${input.message}.`,
      input.occurredAt ?? this.clock.now(),
    );
  }

  async recordFollowUpCreated(input: BaseInput & {
    followUpId: string;
    dueAt: Date;
    occurredAt?: Date;
  }): Promise<void> {
    await this.write(
      input.opportunityId,
      `Email follow-up created for ${input.dueAt.toISOString()}.`,
      input.occurredAt ?? this.clock.now(),
    );
  }

  private async write(opportunityId: string, body: string, occurredAt: Date): Promise<void> {
    const opportunity = await this.deps.opportunities.get(opportunityId);
    if (!opportunity) return;
    await this.deps.activities.create({
      organizationId: opportunity.organizationId,
      ...(opportunity.contactId ? { contactId: opportunity.contactId } : {}),
      ...(opportunity.bookingId ? { bookingId: opportunity.bookingId } : {}),
      kind: "note",
      body,
      occurredAt,
    });
  }
}
