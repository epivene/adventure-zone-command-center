import { AssistantConversationRepository, type AssistantConversationView } from "./assistant-conversation-repository";
import { answerGeneralAssistant, type GeneralAssistantResponse } from "./general-assistant";
import { PostgresProfileSearchRepository } from "./profile-search-repository";

export const GENERAL_ASSISTANT_CONTEXT_KIND = "organization" as const;
export const GENERAL_ASSISTANT_CONTEXT_RECORD_ID = "00000000-0000-0000-0000-000000000000";

export type GeneralConversationAskResult = {
  conversationId: string;
  response: GeneralAssistantResponse;
};

type ConversationStore = Pick<
  AssistantConversationRepository,
  "ensureConversation" | "appendPlainExchange" | "getConversation"
>;

type AnswerGeneral = (input: { question: string }) => Promise<GeneralAssistantResponse>;

function responseText(response: GeneralAssistantResponse): string {
  return response.kind === "answer" ? response.answer.text : response.text;
}

export class GeneralConversationService {
  private readonly conversations: ConversationStore;
  private readonly answerGeneral: AnswerGeneral;

  constructor(input?: {
    conversations?: ConversationStore;
    answerGeneral?: AnswerGeneral;
  }) {
    this.conversations = input?.conversations ?? new AssistantConversationRepository();
    const profileSearch = new PostgresProfileSearchRepository();
    this.answerGeneral = input?.answerGeneral ?? ((request) => answerGeneralAssistant({
      question: request.question,
      profileSearch,
    }));
  }

  async ask(input: {
    actorId: string;
    conversationId?: string;
    question: string;
  }): Promise<GeneralConversationAskResult> {
    const conversationId = await this.conversations.ensureConversation({
      conversationId: input.conversationId,
      actorId: input.actorId,
      contextKind: GENERAL_ASSISTANT_CONTEXT_KIND,
      contextRecordId: GENERAL_ASSISTANT_CONTEXT_RECORD_ID,
      firstQuestion: input.question,
    });

    const response = await this.answerGeneral({ question: input.question });
    await this.conversations.appendPlainExchange({
      conversationId,
      actorId: input.actorId,
      question: input.question,
      answerText: responseText(response),
    });

    return { conversationId, response };
  }

  get(input: { actorId: string; conversationId: string }): Promise<AssistantConversationView | null> {
    return this.conversations.getConversation(input);
  }
}
