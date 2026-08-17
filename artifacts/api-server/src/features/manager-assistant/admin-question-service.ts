import { buildManagerAssistantContext, type ManagerAssistantContextSource } from "./manager-assistant-context";
import {
  createAdminQuestionRecord,
  type AdminQuestionStore,
} from "./admin-question-repository";
import type { ManagerAssistantContextKind } from "./manager-assistant-types";

export class AdminQuestionService {
  constructor(private readonly dependencies: {
    source: ManagerAssistantContextSource;
    store: AdminQuestionStore;
  }) {}

  async create(input: {
    authenticatedLegId: string;
    managerSessionSubject: string;
    contextKind: ManagerAssistantContextKind;
    contextRecordId: string;
    clientMutationId: string;
    question: string;
    urgency: "normal" | "urgent";
    escalationReason: string;
  }): Promise<
    | { ok: true; question: Awaited<ReturnType<typeof createAdminQuestionRecord>> }
    | { ok: false; code: "OUTSIDE_LEG" }
  > {
    const context = await buildManagerAssistantContext({
      authenticatedLegId: input.authenticatedLegId,
      request: {
        contextKind: input.contextKind,
        contextRecordId: input.contextRecordId,
      },
      source: this.dependencies.source,
    });
    if (!context) return { ok: false, code: "OUTSIDE_LEG" };

    const question = await createAdminQuestionRecord(this.dependencies.store, {
      clientMutationId: input.clientMutationId,
      travelLegId: input.authenticatedLegId,
      bookingId: input.contextKind === "booking" ? input.contextRecordId : null,
      tripId: input.contextKind === "route" ? input.contextRecordId : null,
      managerSessionSubject: input.managerSessionSubject,
      question: input.question,
      urgency: input.urgency,
      escalationReason: input.escalationReason,
      checkedSourceRefs: context.sources,
      contextSnapshot: {
        leg: context.leg,
        activeContext: context.activeContext,
        activeEvent: context.activeEvent,
        route: context.route,
        handoffs: context.handoffs,
        acknowledgments: context.acknowledgments,
        operationalInstructions: context.operationalInstructions,
        knowledge: context.knowledge,
      },
    });
    return { ok: true, question };
  }
}
