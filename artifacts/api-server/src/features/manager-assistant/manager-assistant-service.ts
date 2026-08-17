import { buildManagerAssistantContext, type ManagerAssistantContextSource } from "./manager-assistant-context";
import { answerManagerDeterministically } from "./manager-deterministic-answers";
import type { ManagerAskInput, ManagerContextInput } from "./manager-assistant-input";

export class ManagerAssistantService {
  constructor(private readonly source: ManagerAssistantContextSource) {}

  async getContext(input: {
    authenticatedLegId: string;
    request: ManagerContextInput;
  }) {
    return buildManagerAssistantContext({
      authenticatedLegId: input.authenticatedLegId,
      request: input.request,
      source: this.source,
    });
  }

  async ask(input: {
    authenticatedLegId: string;
    request: ManagerAskInput;
  }) {
    const context = await this.getContext({
      authenticatedLegId: input.authenticatedLegId,
      request: input.request,
    });
    if (!context) return null;
    return {
      context,
      answer: answerManagerDeterministically({
        question: input.request.question,
        context,
      }),
    };
  }
}
