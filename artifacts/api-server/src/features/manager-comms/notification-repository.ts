import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;

export type ManagerNotification = {
  id: string;
  legId: string;
  kind: "message" | "request_update" | "attachment_filed" | "admin_change" | "admin_reply";
  title: string;
  body: string | null;
  actionRequired: boolean;
  sourceType: string | null;
  sourceId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

const ensureSql = sql.raw(`
create table if not exists manager_notifications (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null,
  kind text not null check (kind in ('message','request_update','attachment_filed','admin_change','admin_reply')),
  title text not null,
  body text,
  action_required boolean not null default false,
  source_type text,
  source_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists manager_notifications_leg_unread_idx
  on manager_notifications(leg_id, read_at, created_at desc);
`);

export class NotificationRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema() { await this.database.execute(ensureSql); }

  async create(input: Omit<ManagerNotification, "id" | "readAt" | "createdAt">) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into manager_notifications (
        leg_id, kind, title, body, action_required, source_type, source_id
      ) values (
        ${input.legId}::uuid, ${input.kind}, ${input.title}, ${input.body}, ${input.actionRequired},
        ${input.sourceType}, ${input.sourceId}
      )
      returning id, leg_id as "legId", kind, title, body, action_required as "actionRequired",
        source_type as "sourceType", source_id as "sourceId", read_at as "readAt", created_at as "createdAt"
    `);
    const notice = rows<ManagerNotification>(result)[0];
    if (!notice) throw new Error("Notification could not be created");
    return notice;
  }

  async listForLeg(legId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select id, leg_id as "legId", kind, title, body, action_required as "actionRequired",
        source_type as "sourceType", source_id as "sourceId", read_at as "readAt", created_at as "createdAt"
      from manager_notifications
      where leg_id = ${legId}::uuid
      order by action_required desc, (read_at is null) desc, created_at desc
      limit 100
    `);
    return rows<ManagerNotification>(result);
  }

  async markRead(id: string, legId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      update manager_notifications set read_at = coalesce(read_at, now())
      where id = ${id}::uuid and leg_id = ${legId}::uuid and action_required = false
      returning id
    `);
    return Boolean(rows(result)[0]);
  }
}
