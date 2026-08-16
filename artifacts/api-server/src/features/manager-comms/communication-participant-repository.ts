import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import type { MessageAttachment } from "./communication-repository";

type DrizzleDatabase = typeof database;
function rows<T>(value: unknown): T[] { return ((value as { rows?: T[] }).rows ?? []) as T[]; }

export class CommunicationParticipantRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSupportSchema() {
    await this.database.execute(sql.raw(`
      alter table manager_conversations add column if not exists scope_key text;
      create unique index if not exists manager_conversations_scope_key_unique
        on manager_conversations(scope_key) where scope_key is not null;
    `));
  }

  async listMemberLegIds(conversationId: string): Promise<string[]> {
    await this.ensureSupportSchema();
    const result = await this.database.execute(sql`
      select leg_id as "legId" from manager_conversation_members
      where conversation_id = ${conversationId}::uuid order by leg_id
    `);
    return rows<{ legId: string }>(result).map((row) => row.legId);
  }

  async canManagerViewConversation(conversationId: string, legId: string) {
    await this.ensureSupportSchema();
    const result = await this.database.execute(sql`
      select c.id from manager_conversations c
      left join manager_conversation_members m
        on m.conversation_id = c.id and m.leg_id = ${legId}::uuid
      where c.id = ${conversationId}::uuid
        and (c.kind = 'all_managers' or m.leg_id is not null)
      limit 1
    `);
    return Boolean(rows(result)[0]);
  }

  async ensureDefaultConversations(legId: string, legName: string | null) {
    await this.ensureSupportSchema();
    const global = await this.database.execute(sql`
      insert into manager_conversations(kind,title,scope_key)
      values ('all_managers','All Managers','all-managers')
      on conflict (scope_key) where scope_key is not null
      do update set title = excluded.title
      returning id
    `);
    const globalId = rows<{ id: string }>(global)[0]?.id;
    const leg = await this.database.execute(sql`
      insert into manager_conversations(kind,title,scope_key)
      values ('leg_admin',${legName ? `${legName} + Admin` : "My Leg + Admin"},${`leg-admin:${legId}`})
      on conflict (scope_key) where scope_key is not null
      do update set title = excluded.title
      returning id
    `);
    const legConversationId = rows<{ id: string }>(leg)[0]?.id;
    if (legConversationId) {
      await this.database.execute(sql`
        insert into manager_conversation_members(conversation_id,leg_id)
        values (${legConversationId}::uuid,${legId}::uuid) on conflict do nothing
      `);
    }
    return { globalId: globalId ?? null, legConversationId: legConversationId ?? null };
  }

  async listAttachmentsForMessages(messageIds: string[]): Promise<MessageAttachment[]> {
    if (!messageIds.length) return [];
    await this.ensureSupportSchema();
    const quoted = messageIds.map((id) => `'${id.replaceAll("'", "''")}'::uuid`).join(",");
    const result = await this.database.execute(sql.raw(`
      select id, conversation_id as "conversationId", message_id as "messageId",
        uploader_kind as "uploaderKind", uploader_leg_id as "uploaderLegId", uploader_name as "uploaderName",
        file_name as "fileName", mime_type as "mimeType", size_bytes::int as "sizeBytes",
        object_key as "objectKey", upload_status as "uploadStatus",
        created_at as "createdAt", updated_at as "updatedAt"
      from manager_message_attachments
      where message_id in (${quoted})
      order by created_at asc
    `));
    return rows<MessageAttachment>(result);
  }
}
