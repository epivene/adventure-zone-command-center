import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import type {
  AssistantAnswer,
  AssistantContextKind,
  AssistantSourceReference,
} from "./assistant-types";

export type AssistantConversationMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  answerMode: "deterministic" | "cloud" | "offline_cached" | null;
  confidence: "high" | "medium" | "low" | null;
  createdAt: string;
  sources: AssistantSourceReference[];
};

export type AssistantConversationView = {
  id: string;
  contextKind: AssistantContextKind;
  contextRecordId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantConversationMessage[];
};

export class AssistantConversationRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async ensureConversation(input: {
    conversationId?: string;
    actorId: string;
    contextKind: AssistantContextKind;
    contextRecordId: string;
    firstQuestion: string;
  }): Promise<string> {
    if (input.conversationId) {
      const existing = await this.pool.query(
        `SELECT id
         FROM assistant_conversations
         WHERE id = $1
           AND actor_id = $2
           AND context_kind = $3
           AND context_record_id = $4`,
        [
          input.conversationId,
          input.actorId,
          input.contextKind,
          input.contextRecordId,
        ],
      );
      if (!existing.rows[0]) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
      return existing.rows[0].id as string;
    }

    const title = input.firstQuestion.trim().slice(0, 100) || "Booking Assistant";
    const created = await this.pool.query(
      `INSERT INTO assistant_conversations
         (actor_id, context_kind, context_record_id, title)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.actorId, input.contextKind, input.contextRecordId, title],
    );
    return created.rows[0].id as string;
  }

  async appendExchange(input: {
    conversationId: string;
    actorId: string;
    question: string;
    answer: AssistantAnswer;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        `SELECT id
         FROM assistant_conversations
         WHERE id = $1 AND actor_id = $2
         FOR UPDATE`,
        [input.conversationId, input.actorId],
      );
      if (!owned.rows[0]) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");

      await client.query(
        `INSERT INTO assistant_messages (conversation_id, role, body)
         VALUES ($1, 'user', $2)`,
        [input.conversationId, input.question.trim()],
      );
      const assistantMessage = await client.query(
        `INSERT INTO assistant_messages
           (conversation_id, role, body, answer_mode, confidence)
         VALUES ($1, 'assistant', $2, $3, $4)
         RETURNING id`,
        [
          input.conversationId,
          input.answer.text,
          input.answer.mode,
          input.answer.confidence,
        ],
      );
      const messageId = assistantMessage.rows[0].id as string;

      for (const source of input.answer.sources) {
        await client.query(
          `INSERT INTO assistant_message_sources
             (message_id, source_kind, source_record_id, label, occurred_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            messageId,
            source.kind,
            source.recordId,
            source.label,
            source.occurredAt,
          ],
        );
      }
      await client.query(
        `UPDATE assistant_conversations SET updated_at = now() WHERE id = $1`,
        [input.conversationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getConversation(input: {
    conversationId: string;
    actorId: string;
  }): Promise<AssistantConversationView | null> {
    const conversationResult = await this.pool.query(
      `SELECT id, context_kind, context_record_id, title, created_at, updated_at
       FROM assistant_conversations
       WHERE id = $1 AND actor_id = $2`,
      [input.conversationId, input.actorId],
    );
    const conversation = conversationResult.rows[0];
    if (!conversation) return null;

    const messageResult = await this.pool.query(
      `SELECT id, role, body, answer_mode, confidence, created_at
       FROM assistant_messages
       WHERE conversation_id = $1
       ORDER BY created_at, id`,
      [input.conversationId],
    );
    const messageIds = messageResult.rows.map((row) => row.id as string);
    const sourcesResult = messageIds.length
      ? await this.pool.query(
          `SELECT message_id, source_kind, source_record_id, label, occurred_at
           FROM assistant_message_sources
           WHERE message_id = ANY($1::uuid[])
           ORDER BY message_id, id`,
          [messageIds],
        )
      : { rows: [] as any[] };

    return {
      id: conversation.id,
      contextKind: conversation.context_kind,
      contextRecordId: conversation.context_record_id,
      title: conversation.title,
      createdAt: new Date(conversation.created_at).toISOString(),
      updatedAt: new Date(conversation.updated_at).toISOString(),
      messages: messageResult.rows.map((message) => ({
        id: message.id,
        role: message.role,
        body: message.body,
        answerMode: message.answer_mode,
        confidence: message.confidence,
        createdAt: new Date(message.created_at).toISOString(),
        sources: sourcesResult.rows
          .filter((source) => source.message_id === message.id)
          .map((source) => ({
            id: `persisted_${message.id}_${source.source_kind}_${source.source_record_id}`,
            kind: source.source_kind,
            recordId: source.source_record_id,
            label: source.label,
            occurredAt: source.occurred_at
              ? new Date(source.occurred_at).toISOString()
              : null,
          })),
      })),
    };
  }
}
