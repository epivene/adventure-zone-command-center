import type {
  CompleteFollowUpInput,
  DomainError,
} from "@/features/bookings/booking-service";
import type { FollowUp } from "@/features/bookings/booking-repository";
import type { Result } from "@/lib/result";
import type {
  OpportunityStatus,
  UpdateOpportunityInput,
} from "./opportunity-types";

export type OpportunityEvent =
  | { kind: "research_started" }
  | { kind: "ready_checks_complete" }
  | { kind: "first_contact_completed" }
  | { kind: "follow_up_created"; dueAt: Date }
  | { kind: "booking_started" }
  | { kind: "booking_confirmed" }
  | { kind: "positive_response" };

export type TransitionResult = {
  appliedStatus: OpportunityStatus | null;
  suggestedStatus: OpportunityStatus | null;
};

type FollowUpCompletionService = {
  completeFollowUp(
    input: CompleteFollowUpInput,
  ): Promise<Result<FollowUp, DomainError>>;
};

type OpportunityMutationRepository = {
  update(
    id: string,
    patch: UpdateOpportunityInput,
  ): Promise<unknown>;
};

export type CompleteOpportunityFollowUpInput = CompleteFollowUpInput & {
  opportunityId: string;
};

const authoritativeStatusByEvent: Record<
  Exclude<OpportunityEvent["kind"], "positive_response">,
  OpportunityStatus
> = {
  research_started: "researching",
  ready_checks_complete: "ready_to_contact",
  first_contact_completed: "contacted",
  follow_up_created: "follow_up",
  booking_started: "booking_in_progress",
  booking_confirmed: "booked",
};

export function deriveOpportunityTransition(
  current: OpportunityStatus,
  event: OpportunityEvent,
): TransitionResult {
  if (event.kind === "positive_response") {
    return {
      appliedStatus: null,
      suggestedStatus: current === "interested" ? null : "interested",
    };
  }

  const nextStatus = authoritativeStatusByEvent[event.kind];
  return {
    appliedStatus: current === nextStatus ? null : nextStatus,
    suggestedStatus: null,
  };
}

export class OpportunityService {
  constructor(
    private readonly followUps: FollowUpCompletionService,
    private readonly opportunities: OpportunityMutationRepository,
  ) {}

  async completeFollowUp(
    input: CompleteOpportunityFollowUpInput,
  ): Promise<Result<FollowUp, DomainError>> {
    const result = await this.followUps.completeFollowUp({
      followUpId: input.followUpId,
      outcome: input.outcome,
      status: input.status,
      nextAction: input.nextAction,
    });

    if (!result.ok || !input.nextAction) return result;

    await this.opportunities.update(input.opportunityId, {
      status: "follow_up",
      nextActionKind: input.nextAction.kind,
      nextActionDueAt: input.nextAction.dueAt,
    });

    return result;
  }
}
