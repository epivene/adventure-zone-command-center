import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;
export type AcknowledgmentStatus = "waiting_acknowledgment" | "acknowledged" | "needs_admin_review" | "resolved";
export type AcknowledgmentItem = { id:string; acknowledgmentId:string; label:string; beforeValue:string|null; afterValue:string|null; position:number };
export type AcknowledgmentEvent = { id:string; acknowledgmentId:string; kind:"created"|"manager_acknowledged"|"manager_commented"|"resolved"; actor:string|null; body:string|null; createdAt:Date };
export type ManagerAcknowledgment = {
  id:string; actionId:string; legId:string; status:AcknowledgmentStatus; actor:string; sourceType:string; sourceId:string|null; title:string;
  managerComment:string|null; adminResponse:string|null; acknowledgedAt:Date|null; resolvedAt:Date|null; createdAt:Date; updatedAt:Date; items:AcknowledgmentItem[];
};
function rows<T>(value:unknown):T[]{ return ((value as {rows?:T[]}).rows ?? []) as T[]; }
function date(value:unknown):Date|null { return value == null ? null : value instanceof Date ? value : new Date(String(value)); }
const ensureSql=sql.raw(`
create extension if not exists pgcrypto;
create table if not exists manager_acknowledgments(
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null,
  leg_id uuid not null,
  status text not null default 'waiting_acknowledgment' check(status in('waiting_acknowledgment','acknowledged','needs_admin_review','resolved')),
  actor text not null,
  source_type text not null,
  source_id text,
  title text not null,
  manager_comment text,
  admin_response text,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(action_id,leg_id)
);
create index if not exists manager_acknowledgments_leg_status_idx on manager_acknowledgments(leg_id,status,created_at desc);
create table if not exists manager_acknowledgment_items(
  id uuid primary key default gen_random_uuid(),
  acknowledgment_id uuid not null references manager_acknowledgments(id) on delete cascade,
  label text not null,
  before_value text,
  after_value text,
  position integer not null default 0
);
create index if not exists manager_acknowledgment_items_ack_idx on manager_acknowledgment_items(acknowledgment_id,position,id);
create table if not exists manager_acknowledgment_events(
  id uuid primary key default gen_random_uuid(),
  acknowledgment_id uuid not null references manager_acknowledgments(id) on delete cascade,
  kind text not null check(kind in('created','manager_acknowledged','manager_commented','resolved')),
  actor text,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists manager_acknowledgment_events_ack_idx on manager_acknowledgment_events(acknowledgment_id,created_at,id);
`);

export class AcknowledgmentRepository {
  constructor(private readonly database:DrizzleDatabase){}
  async ensureSchema(){ await this.database.execute(ensureSql); }
  private async hydrate(row:any):Promise<ManagerAcknowledgment>{
    const itemResult=await this.database.execute(sql`select id,acknowledgment_id as "acknowledgmentId",label,before_value as "beforeValue",after_value as "afterValue",position from manager_acknowledgment_items where acknowledgment_id=${row.id}::uuid order by position,id`);
    return {...row, acknowledgedAt:date(row.acknowledgedAt), resolvedAt:date(row.resolvedAt), createdAt:date(row.createdAt)!, updatedAt:date(row.updatedAt)!, items:rows<AcknowledgmentItem>(itemResult)};
  }
  private selectBase=`select id,action_id as "actionId",leg_id as "legId",status,actor,source_type as "sourceType",source_id as "sourceId",title,manager_comment as "managerComment",admin_response as "adminResponse",acknowledged_at as "acknowledgedAt",resolved_at as "resolvedAt",created_at as "createdAt",updated_at as "updatedAt" from manager_acknowledgments`;
  async get(id:string){ await this.ensureSchema(); const result=await this.database.execute(sql.raw(`${this.selectBase} where id='${id.replaceAll("'","''")}'::uuid limit 1`)); const row=rows<any>(result)[0]; return row?this.hydrate(row):null; }
  async listForLeg(legId:string){ await this.ensureSchema(); const result=await this.database.execute(sql.raw(`${this.selectBase} where leg_id='${legId.replaceAll("'","''")}'::uuid order by created_at desc`)); return Promise.all(rows<any>(result).map((row)=>this.hydrate(row))); }
  async listActiveForLeg(legId:string){ await this.ensureSchema(); const result=await this.database.execute(sql.raw(`${this.selectBase} where leg_id='${legId.replaceAll("'","''")}'::uuid and status in('waiting_acknowledgment','needs_admin_review') order by created_at desc`)); return Promise.all(rows<any>(result).map((row)=>this.hydrate(row))); }
  async listNeedsAdminReview(){ await this.ensureSchema(); const result=await this.database.execute(sql.raw(`${this.selectBase} where status='needs_admin_review' order by updated_at desc`)); return Promise.all(rows<any>(result).map((row)=>this.hydrate(row))); }
  async createOrGet(input:{actionId:string;legId:string;actor:string;sourceType:string;sourceId:string|null;title:string;items:Array<{label:string;beforeValue:string|null;afterValue:string|null}>}){
    await this.ensureSchema();
    const inserted=await this.database.execute(sql`insert into manager_acknowledgments(action_id,leg_id,actor,source_type,source_id,title) values(${input.actionId}::uuid,${input.legId}::uuid,${input.actor},${input.sourceType},${input.sourceId},${input.title}) on conflict(action_id,leg_id) do nothing returning id`);
    let id=rows<{id:string}>(inserted)[0]?.id;
    if(!id){ const existing=await this.database.execute(sql`select id from manager_acknowledgments where action_id=${input.actionId}::uuid and leg_id=${input.legId}::uuid limit 1`); id=rows<{id:string}>(existing)[0]?.id; }
    if(!id) throw new Error("Acknowledgment could not be saved");
    if(rows(inserted).length){
      for(let index=0; index<input.items.length; index+=1){ const item=input.items[index]!; await this.database.execute(sql`insert into manager_acknowledgment_items(acknowledgment_id,label,before_value,after_value,position) values(${id}::uuid,${item.label},${item.beforeValue},${item.afterValue},${index})`); }
      await this.database.execute(sql`insert into manager_acknowledgment_events(acknowledgment_id,kind,actor) values(${id}::uuid,'created',${input.actor})`);
    }
    return this.get(id);
  }
  async acknowledge(id:string,legId:string,comment:string|null){
    await this.ensureSchema();
    const status:AcknowledgmentStatus=comment?.trim()?"needs_admin_review":"acknowledged";
    const result=await this.database.execute(sql`update manager_acknowledgments set status=${status},manager_comment=${comment?.trim()||null},acknowledged_at=coalesce(acknowledged_at,now()),updated_at=now() where id=${id}::uuid and leg_id=${legId}::uuid and status='waiting_acknowledgment' returning id`);
    if(!rows(result)[0]) return null;
    await this.database.execute(sql`insert into manager_acknowledgment_events(acknowledgment_id,kind,actor,body) values(${id}::uuid,${comment?.trim()?"manager_commented":"manager_acknowledged"},${legId},${comment?.trim()||null})`);
    return this.get(id);
  }
  async resolve(id:string,response:string|null,actor:string){
    await this.ensureSchema();
    const result=await this.database.execute(sql`update manager_acknowledgments set status='resolved',admin_response=${response?.trim()||null},resolved_at=now(),updated_at=now() where id=${id}::uuid and status in('needs_admin_review','waiting_acknowledgment','acknowledged') returning id`);
    if(!rows(result)[0]) return null;
    await this.database.execute(sql`insert into manager_acknowledgment_events(acknowledgment_id,kind,actor,body) values(${id}::uuid,'resolved',${actor},${response?.trim()||null})`);
    return this.get(id);
  }
  async listEvents(id:string){ await this.ensureSchema(); const result=await this.database.execute(sql`select id,acknowledgment_id as "acknowledgmentId",kind,actor,body,created_at as "createdAt" from manager_acknowledgment_events where acknowledgment_id=${id}::uuid order by created_at,id`); return rows<any>(result).map((row)=>({...row,createdAt:date(row.createdAt)!})) as AcknowledgmentEvent[]; }
}
