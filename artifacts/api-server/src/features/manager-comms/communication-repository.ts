import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

export type ConversationKind = "all_managers" | "leg_admin" | "direct" | "group";
export type MessageActor =
  | { kind: "manager"; legId: string; name: string | null }
  | { kind: "admin"; name: string | null };

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  unreadCount: number;
};

export type ManagerMessage = {
  id: string;
  conversationId: string;
  actorKind: "manager" | "admin";
  actorLegId: string | null;
  actorName: string | null;
  body: string;
  clientMutationId: string;
  createdAt: Date;
};

export type MessageAttachment = {
  id: string;
  conversationId: string;
  messageId: string | null;
  uploaderKind: "manager" | "admin";
  uploaderLegId: string | null;
  uploaderName: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  objectKey: string | null;
  uploadStatus: "pending" | "uploaded";
  createdAt: Date;
  updatedAt: Date;
};

type DrizzleDatabase = typeof database;

function resultRows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

function actorKey(actor: MessageActor) {
  return actor.kind === "manager" ? `manager:${actor.legId}` : "admin";
}

const ensureSql = sql.raw(`
create extension if not exists pgcrypto;

create table if not exists manager_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('all_managers','leg_admin','direct','group')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists manager_conversation_members (
  conversation_id uuid not null references manager_conversations(id) on delete cascade,
  leg_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, leg_id)
);
create index if not exists manager_conversation_members_leg_idx
  on manager_conversation_members(leg_id, conversation_id);

create table if not exists manager_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references manager_conversations(id) on delete cascade,
  actor_kind text not null check (actor_kind in ('manager','admin')),
  actor_leg_id uuid,
  actor_name text,
  actor_key text not null,
  body text not null,
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, actor_key, client_mutation_id)
);
create index if not exists manager_messages_conversation_created_idx
  on manager_messages(conversation_id, created_at, id);

create table if not exists manager_message_reads (
  conversation_id uuid not null references manager_conversations(id) on delete cascade,
  leg_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (conversation_id, leg_id)
);

create table if not exists manager_admin_message_reads (
  conversation_id uuid primary key references manager_conversations(id) on delete cascade,
  read_at timestamptz not null default now()
);

create table if not exists manager_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references manager_conversations(id) on delete cascade,
  message_id uuid references manager_messages(id) on delete set null,
  uploader_kind text not null check (uploader_kind in ('manager','admin')),
  uploader_leg_id uuid,
  uploader_name text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  object_key text,
  upload_status text not null default 'pending' check (upload_status in ('pending','uploaded')),
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, uploader_kind, uploader_leg_id, client_mutation_id)
);
create index if not exists manager_message_attachments_message_idx
  on manager_message_attachments(message_id);
`);

export class CommunicationRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema() {
    this.schemaReady ??= this.database.execute(ensureSql)
      .then(() => undefined)
      .catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    await this.schemaReady;
  }

  private async conversationExists(id: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select id, kind from manager_conversations where id = ${id}::uuid limit 1
    `);
    return resultRows<{ id: string; kind: ConversationKind }>(result)[0] ?? null;
  }

  private async managerCanView(conversationId: string, legId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select c.id
      from manager_conversations c
      left join manager_conversation_members m
        on m.conversation_id = c.id and m.leg_id = ${legId}::uuid
      where c.id = ${conversationId}::uuid
        and (c.kind = 'all_managers' or m.leg_id is not null)
      limit 1
    `);
    return Boolean(resultRows(result)[0]);
  }

  async createConversation(input: {
    kind: ConversationKind;
    title: string | null;
    memberLegIds: string[];
  }) {
    await this.ensureSchema();
    const created = await this.database.execute(sql`
      insert into manager_conversations (kind, title)
      values (${input.kind}, ${input.title})
      returning id, kind, title, created_at as "createdAt", updated_at as "updatedAt"
    `);
    const conversation = resultRows<Omit<ConversationSummary, "unreadCount">>(created)[0];
    if (!conversation) throw new Error("Conversation could not be created");
    const uniqueLegIds = [...new Set(input.memberLegIds)];
    for (const legId of uniqueLegIds) {
      await this.database.execute(sql`
        insert into manager_conversation_members (conversation_id, leg_id)
        values (${conversation.id}::uuid, ${legId}::uuid)
        on conflict do nothing
      `);
    }
    return { ...conversation, unreadCount: 0 };
  }

  async listForManager(legId: string): Promise<ConversationSummary[]> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select c.id, c.kind, c.title,
        c.created_at as "createdAt", c.updated_at as "updatedAt",
        count(msg.id) filter (
          where msg.created_at > coalesce(r.read_at, 'epoch'::timestamptz)
            and (msg.actor_leg_id is null or msg.actor_leg_id <> ${legId}::uuid)
        )::int as "unreadCount"
      from manager_conversations c
      left join manager_conversation_members member
        on member.conversation_id = c.id and member.leg_id = ${legId}::uuid
      left join manager_message_reads r
        on r.conversation_id = c.id and r.leg_id = ${legId}::uuid
      left join manager_messages msg on msg.conversation_id = c.id
      where c.kind = 'all_managers' or member.leg_id is not null
      group by c.id, r.read_at
      order by c.updated_at desc, c.created_at desc
    `);
    return resultRows<ConversationSummary>(result);
  }

  async listAllForAdmin(): Promise<ConversationSummary[]> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select c.id, c.kind, c.title,
        c.created_at as "createdAt", c.updated_at as "updatedAt",
        count(msg.id) filter (
          where msg.created_at > coalesce(r.read_at, 'epoch'::timestamptz)
            and msg.actor_kind = 'manager'
        )::int as "unreadCount"
      from manager_conversations c
      left join manager_admin_message_reads r on r.conversation_id = c.id
      left join manager_messages msg on msg.conversation_id = c.id
      group by c.id, r.read_at
      order by c.updated_at desc, c.created_at desc
    `);
    return resultRows<ConversationSummary>(result);
  }

  async getMessages(conversationId: string, viewer: MessageActor): Promise<ManagerMessage[]> {
    const exists = await this.conversationExists(conversationId);
    if (!exists) throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
    if (viewer.kind === "manager" && !(await this.managerCanView(conversationId, viewer.legId))) {
      throw Object.assign(new Error("Conversation is outside your access"), { code: "FORBIDDEN" });
    }
    const result = await this.database.execute(sql`
      select id, conversation_id as "conversationId", actor_kind as "actorKind",
        actor_leg_id as "actorLegId", actor_name as "actorName", body,
        client_mutation_id as "clientMutationId", created_at as "createdAt"
      from manager_messages
      where conversation_id = ${conversationId}::uuid
      order by created_at asc, id asc
    `);
    return resultRows<ManagerMessage>(result);
  }

  async sendMessage(input: {
    conversationId: string;
    actor: MessageActor;
    body: string;
    clientMutationId: string;
  }): Promise<ManagerMessage> {
    const exists = await this.conversationExists(input.conversationId);
    if (!exists) throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
    if (input.actor.kind === "manager" && !(await this.managerCanView(input.conversationId, input.actor.legId))) {
      throw Object.assign(new Error("Conversation is outside your access"), { code: "FORBIDDEN" });
    }
    const key = actorKey(input.actor);
    const actorLegId = input.actor.kind === "manager" ? input.actor.legId : null;
    const inserted = await this.database.execute(sql`
      insert into manager_messages (
        conversation_id, actor_kind, actor_leg_id, actor_name, actor_key, body, client_mutation_id
      ) values (
        ${input.conversationId}::uuid, ${input.actor.kind}, ${actorLegId}::uuid,
        ${input.actor.name}, ${key}, ${input.body}, ${input.clientMutationId}::uuid
      )
      on conflict (conversation_id, actor_key, client_mutation_id) do nothing
      returning id
    `);
    let id = resultRows<{ id: string }>(inserted)[0]?.id;
    if (!id) {
      const existing = await this.database.execute(sql`
        select id from manager_messages
        where conversation_id = ${input.conversationId}::uuid
          and actor_key = ${key}
          and client_mutation_id = ${input.clientMutationId}::uuid
        limit 1
      `);
      id = resultRows<{ id: string }>(existing)[0]?.id;
    }
    if (!id) throw new Error("Message could not be saved");
    await this.database.execute(sql`
      update manager_conversations set updated_at = now() where id = ${input.conversationId}::uuid
    `);
    const saved = await this.database.execute(sql`
      select id, conversation_id as "conversationId", actor_kind as "actorKind",
        actor_leg_id as "actorLegId", actor_name as "actorName", body,
        client_mutation_id as "clientMutationId", created_at as "createdAt"
      from manager_messages where id = ${id}::uuid limit 1
    `);
    const message = resultRows<ManagerMessage>(saved)[0];
    if (!message) throw new Error("Saved message could not be loaded");
    return message;
  }

  async markConversationRead(conversationId: string, legId: string) {
    if (!(await this.managerCanView(conversationId, legId))) {
      throw Object.assign(new Error("Conversation is outside your access"), { code: "FORBIDDEN" });
    }
    await this.database.execute(sql`
      insert into manager_message_reads (conversation_id, leg_id, read_at)
      values (${conversationId}::uuid, ${legId}::uuid, now())
      on conflict (conversation_id, leg_id) do update set read_at = excluded.read_at
    `);
  }

  async markConversationReadForAdmin(conversationId: string) {
    if (!(await this.conversationExists(conversationId))) {
      throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
    }
    await this.database.execute(sql`
      insert into manager_admin_message_reads (conversation_id, read_at)
      values (${conversationId}::uuid, now())
      on conflict (conversation_id) do update set read_at = excluded.read_at
    `);
  }

  async createAttachment(input: {
    id: string;
    conversationId: string;
    actor: MessageActor;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    clientMutationId: string;
  }): Promise<MessageAttachment> {
    const exists = await this.conversationExists(input.conversationId);
    if (!exists) throw Object.assign(new Error("Conversation not found"), { code: "NOT_FOUND" });
    if (input.actor.kind === "manager" && !(await this.managerCanView(input.conversationId, input.actor.legId))) {
      throw Object.assign(new Error("Conversation is outside your access"), { code: "FORBIDDEN" });
    }
    const legId = input.actor.kind === "manager" ? input.actor.legId : null;
    const result = await this.database.execute(sql`
      insert into manager_message_attachments (
        id, conversation_id, uploader_kind, uploader_leg_id, uploader_name,
        file_name, mime_type, size_bytes, client_mutation_id
      ) values (
        ${input.id}::uuid, ${input.conversationId}::uuid, ${input.actor.kind}, ${legId}::uuid,
        ${input.actor.name}, ${input.fileName}, ${input.mimeType}, ${input.sizeBytes}, ${input.clientMutationId}::uuid
      )
      on conflict (conversation_id, uploader_kind, uploader_leg_id, client_mutation_id)
      do update set file_name = excluded.file_name
      returning id, conversation_id as "conversationId", message_id as "messageId",
        uploader_kind as "uploaderKind", uploader_leg_id as "uploaderLegId", uploader_name as "uploaderName",
        file_name as "fileName", mime_type as "mimeType", size_bytes::int as "sizeBytes",
        object_key as "objectKey", upload_status as "uploadStatus",
        created_at as "createdAt", updated_at as "updatedAt"
    `);
    const attachment = resultRows<MessageAttachment>(result)[0];
    if (!attachment) throw new Error("Attachment could not be created");
    return attachment;
  }

  async getAttachment(id: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select id, conversation_id as "conversationId", message_id as "messageId",
        uploader_kind as "uploaderKind", uploader_leg_id as "uploaderLegId", uploader_name as "uploaderName",
        file_name as "fileName", mime_type as "mimeType", size_bytes::int as "sizeBytes",
        object_key as "objectKey", upload_status as "uploadStatus",
        created_at as "createdAt", updated_at as "updatedAt"
      from manager_message_attachments where id = ${id}::uuid limit 1
    `);
    return resultRows<MessageAttachment>(result)[0] ?? null;
  }

  async setAttachmentUploaded(id: string, objectKey: string, mimeType: string | null) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      update manager_message_attachments
      set object_key = ${objectKey}, mime_type = coalesce(${mimeType}, mime_type),
        upload_status = 'uploaded', updated_at = now()
      where id = ${id}::uuid
      returning id, conversation_id as "conversationId", message_id as "messageId",
        uploader_kind as "uploaderKind", uploader_leg_id as "uploaderLegId", uploader_name as "uploaderName",
        file_name as "fileName", mime_type as "mimeType", size_bytes::int as "sizeBytes",
        object_key as "objectKey", upload_status as "uploadStatus",
        created_at as "createdAt", updated_at as "updatedAt"
    `);
    return resultRows<MessageAttachment>(result)[0] ?? null;
  }

  async attachFileToMessage(attachmentId: string, messageId: string) {
    await this.ensureSchema();
    await this.database.execute(sql`
      update manager_message_attachments
      set message_id = ${messageId}::uuid, updated_at = now()
      where id = ${attachmentId}::uuid
    `);
  }
}
