import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;
export type MeetupRequestStatus = "pending_admin" | "approved" | "dismissed";
export type MeetupRequest = {
  id:string;status:MeetupRequestStatus;requestingLegId:string;otherLegIds:string[];resourceId:string;
  meetupLabel:string;meetupLatitude:number|null;meetupLongitude:number|null;preferredStartsAt:Date;preferredEndsAt:Date;
  notes:string|null;linkedConversationId:string|null;linkedMessageId:string|null;clientMutationId:string;
  handoffId:string|null;adminNotes:string|null;dismissedReason:string|null;createdAt:Date;updatedAt:Date;
};
function rows<T>(value:unknown):T[]{return ((value as {rows?:T[]}).rows??[]) as T[];}
function norm(row:any):MeetupRequest{return {...row,preferredStartsAt:new Date(row.preferredStartsAt),preferredEndsAt:new Date(row.preferredEndsAt),createdAt:new Date(row.createdAt),updatedAt:new Date(row.updatedAt)};}
const ensureSql=sql.raw(`
create table if not exists manager_meetup_requests(
 id uuid primary key default gen_random_uuid(),
 status text not null default 'pending_admin' check(status in('pending_admin','approved','dismissed')),
 requesting_leg_id uuid not null,
 other_leg_ids uuid[] not null,
 resource_id uuid not null references resources(id) on delete restrict,
 meetup_label text not null, meetup_latitude double precision, meetup_longitude double precision,
 preferred_starts_at timestamptz not null, preferred_ends_at timestamptz not null,
 notes text, linked_conversation_id uuid references manager_conversations(id) on delete set null,
 linked_message_id uuid references manager_messages(id) on delete set null,
 client_mutation_id uuid not null, handoff_id uuid, admin_notes text, dismissed_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(requesting_leg_id,client_mutation_id), check(preferred_ends_at>=preferred_starts_at)
);
alter table manager_meetup_requests alter column meetup_latitude drop not null;
alter table manager_meetup_requests alter column meetup_longitude drop not null;
create index if not exists manager_meetup_requests_status_idx on manager_meetup_requests(status,created_at desc);
`);
export class MeetupRequestRepository{
 constructor(private readonly database:DrizzleDatabase){}
 async ensureSchema(){await this.database.execute(ensureSql);}
 private select=`select id,status,requesting_leg_id as "requestingLegId",other_leg_ids as "otherLegIds",resource_id as "resourceId",meetup_label as "meetupLabel",meetup_latitude as "meetupLatitude",meetup_longitude as "meetupLongitude",preferred_starts_at as "preferredStartsAt",preferred_ends_at as "preferredEndsAt",notes,linked_conversation_id as "linkedConversationId",linked_message_id as "linkedMessageId",client_mutation_id as "clientMutationId",handoff_id as "handoffId",admin_notes as "adminNotes",dismissed_reason as "dismissedReason",created_at as "createdAt",updated_at as "updatedAt" from manager_meetup_requests`;
 async findByMutation(legId:string,clientMutationId:string){await this.ensureSchema();const r=await this.database.execute(sql.raw(`${this.select} where requesting_leg_id='${legId.replaceAll("'","''")}'::uuid and client_mutation_id='${clientMutationId.replaceAll("'","''")}'::uuid limit 1`));const x=rows<any>(r)[0];return x?norm(x):null;}
 async get(id:string){await this.ensureSchema();const r=await this.database.execute(sql.raw(`${this.select} where id='${id.replaceAll("'","''")}'::uuid limit 1`));const x=rows<any>(r)[0];return x?norm(x):null;}
 async list(status?:MeetupRequestStatus){await this.ensureSchema();const where=status?` where status='${status}'`:'';const r=await this.database.execute(sql.raw(`${this.select}${where} order by created_at desc`));return rows<any>(r).map(norm);}
 async listForLeg(legId:string){await this.ensureSchema();const safe=legId.replaceAll("'","''");const r=await this.database.execute(sql.raw(`${this.select} where requesting_leg_id='${safe}'::uuid or '${safe}'::uuid=any(other_leg_ids) order by created_at desc`));return rows<any>(r).map(norm);}
 async create(input:Omit<MeetupRequest,"id"|"status"|"handoffId"|"adminNotes"|"dismissedReason"|"createdAt"|"updatedAt">){await this.ensureSchema();const r=await this.database.execute(sql`
  insert into manager_meetup_requests(requesting_leg_id,other_leg_ids,resource_id,meetup_label,meetup_latitude,meetup_longitude,preferred_starts_at,preferred_ends_at,notes,linked_conversation_id,linked_message_id,client_mutation_id)
  values(${input.requestingLegId}::uuid,${input.otherLegIds}::uuid[],${input.resourceId}::uuid,${input.meetupLabel},${input.meetupLatitude},${input.meetupLongitude},${input.preferredStartsAt},${input.preferredEndsAt},${input.notes},${input.linkedConversationId}::uuid,${input.linkedMessageId}::uuid,${input.clientMutationId}::uuid) returning id`);const id=rows<{id:string}>(r)[0]?.id;if(!id)throw new Error('Meetup request could not be saved');return this.get(id);}
 async markApproved(id:string,handoffId:string,adminNotes:string|null=null){await this.ensureSchema();await this.database.execute(sql`update manager_meetup_requests set status='approved',handoff_id=${handoffId}::uuid,admin_notes=${adminNotes},updated_at=now() where id=${id}::uuid and status='pending_admin'`);return this.get(id);}
 async markDismissed(id:string,reason:string|null){await this.ensureSchema();await this.database.execute(sql`update manager_meetup_requests set status='dismissed',dismissed_reason=${reason},updated_at=now() where id=${id}::uuid and status='pending_admin'`);return this.get(id);}
}
