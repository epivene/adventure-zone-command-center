import { describe, expect, it, vi } from "vitest";

import { GeneralConversationService } from "./general-conversation-service";

function makeRepository() {
  const conversations = new Map<string, {
    id: string;
    actorId: string;
    messages: Array<{ role: "user" | "assistant"; body: string }>;
  }>();
  let nextId = 1;

  return {
    ensureConversation: vi.fn(async (input: {
      conversationId?: string;
      actorId: string;
      contextKind: string;
      contextRecordId: string;
    }) => {
      if (input.conversationId) {
        const existing = conversations.get(input.conversationId);
        if (!existing || existing.actorId !== input.actorId) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
        return existing.id;
      }
      const id = `conversation-${nextId++}`;
      conversations.set(id, { id, actorId: input.actorId, messages: [] });
      return id;
    }),
    appendPlainExchange: vi.fn(async (input: {
      conversationId: string;
      actorId: string;
      question: string;
      answerText: string;
    }) => {
      const existing = conversations.get(input.conversationId);
      if (!existing || existing.actorId !== input.actorId) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
      existing.messages.push(
        { role: "user", body: input.question },
        { role: "assistant", body: input.answerText },
      );
    }),
    getConversation: vi.fn(async (input: { conversationId: string; actorId: string }) => {
      const existing = conversations.get(input.conversationId);
      if (!existing || existing.actorId !== input.actorId) return null;
      return {
        id: existing.id,
        contextKind: "organization" as const,
        contextRecordId: "00000000-0000-0000-0000-000000000000",
        title: "General Assistant",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        messages: existing.messages.map((message, index) => ({
          id: `message-${index}`,
          role: message.role,
          body: message.body,
          answerMode: message.role === "assistant" ? "deterministic" as const : null,
          confidence: message.role === "assistant" ? "high" as const : null,
          createdAt: new Date(index).toISOString(),
          sources: [],
        })),
      };
    }),
  };
}

describe("GeneralConversationService", () => {
  it("creates and continues one general conversation without losing earlier messages", async () => {
    const repository = makeRepository();
    const answerGeneral = vi.fn(async ({ question }: { question: string }) => ({
      kind: "needs_context" as const,
      text: `Answer: ${question}`,
    }));
    const service = new GeneralConversationService({ conversations: repository as never, answerGeneral });

    const first = await service.ask({ actorId: "owner-1", question: "Find profiles in Minnesota" });
    const second = await service.ask({
      actorId: "owner-1",
      conversationId: first.conversationId,
      question: "Only show county fairs",
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect((await service.get({ actorId: "owner-1", conversationId: first.conversationId }))?.messages)
      .toHaveLength(4);
  });

  it("does not allow another actor to continue the conversation", async () => {
    const repository = makeRepository();
    const answerGeneral = vi.fn(async () => ({ kind: "needs_context" as const, text: "Answer" }));
    const service = new GeneralConversationService({ conversations: repository as never, answerGeneral });

    const first = await service.ask({ actorId: "owner-1", question: "Find a profile" });

    await expect(service.ask({
      actorId: "owner-2",
      conversationId: first.conversationId,
      question: "continue",
    })).rejects.toThrow("ASSISTANT_CONVERSATION_NOT_FOUND");
  });

  it("stores deterministic text without making an extra model call", async () => {
    const repository = makeRepository();
    const answerGeneral = vi.fn(async () => ({
      kind: "profile_results" as const,
      text: "I found 2 matching profiles.",
      results: [],
    }));
    const service = new GeneralConversationService({ conversations: repository as never, answerGeneral });

    await service.ask({ actorId: "owner-1", question: "Find Minnesota fairs" });

    expect(answerGeneral).toHaveBeenCalledTimes(1);
    expect(repository.appendPlainExchange).toHaveBeenCalledWith(expect.objectContaining({
      answerText: "I found 2 matching profiles.",
    }));
  });
});
