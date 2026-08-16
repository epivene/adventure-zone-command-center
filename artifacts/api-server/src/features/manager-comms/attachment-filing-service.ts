import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import type { NotificationRepository } from "./notification-repository";

type DrizzleDatabase=typeof database;
export type FilingDestination="expense_receipt"|"incident_photo"|"equipment_handoff_photo"|"general_leg_document";
type SourceAttachment={id:string;conversationId:string;messageId:string|null;uploaderKind:"manager"|"admin";uploaderLegId:string|null;uploaderName:string|null;fileName:string|null;mimeType:string|null;objectKey:string|null;uploadStatus:string};
export type AttachmentFiling={id:string;sourceConversationId:string;sourceMessageId:string|null;sourceAttachmentId:string;senderLegId:string|null;destination:FilingDestination;destinationId:string;objectKey:string;adminActor:string;clientMutationId:string;createdAt:Date};

export interface FilingSourceStore { getAttachment(id:string):Promise<SourceAttachment|null>; }
export interface FilingProvenanceStore { findByMutation(clientMutationId:string):Promise<AttachmentFiling|null>; create(input:Omit<AttachmentFiling,"id"|"createdAt">):Promise<AttachmentFiling>; }
export interface FilingDestinationStore {
  fileExpenseReceipt(input:{legId:string;expenseId:string;receiptId:string;objectKey:string;mimeType:string|null;sourceAttachmentId:string;clientMutationId:string}):Promise<{destinationType:string;destinationId:string;objectKey:string}>;
  fileIncidentPhoto(input:{legId:string;incidentId:string;attachmentId:string;objectKey:string;mimeType:string|null;sourceAttachmentId:string;clientMutationId:string}):Promise<{destinationType:string;destinationId:string;objectKey:string}>;
  fileReference(input:{legId:string;destination:"equipment_handoff_photo"|"general_leg_document";destinationId:string;objectKey:string;mimeType:string|null;fileName:string|null;sourceAttachmentId:string}):Promise<{destinationType:string;destinationId:string;objectKey:string}>;
}

type Stores={source:FilingSourceStore;filing:FilingProvenanceStore;destinations:FilingDestinationStore;notifications:Pick<NotificationRepository,"create">};
type Input={attachmentId:string;destination:FilingDestination;destinationMetadata:any;adminActor:string;clientMutationId:string};

function title(destination:FilingDestination){return destination==="expense_receipt"?"Receipt filed":destination==="incident_photo"?"Incident photo filed":destination==="equipment_handoff_photo"?"Handoff photo filed":"Document filed";}

export async function fileMessageAttachment(stores:Stores,input:Input){
  const existing=await stores.filing.findByMutation(input.clientMutationId);if(existing)return existing;
  const attachment=await stores.source.getAttachment(input.attachmentId);
  if(!attachment||attachment.uploadStatus!=="uploaded"||!attachment.objectKey)throw Object.assign(new Error("Attachment is not ready to file"),{code:"NOT_FOUND"});
  const meta=input.destinationMetadata??{};const legId=String(meta.legId??"");if(!legId)throw new Error("Destination leg is required");
  let filed:{destinationType:string;destinationId:string;objectKey:string};
  if(input.destination==="expense_receipt"){
    filed=await stores.destinations.fileExpenseReceipt({legId,expenseId:String(meta.expenseId??""),receiptId:String(meta.receiptId??""),objectKey:attachment.objectKey,mimeType:attachment.mimeType,sourceAttachmentId:attachment.id,clientMutationId:input.clientMutationId});
  }else if(input.destination==="incident_photo"){
    filed=await stores.destinations.fileIncidentPhoto({legId,incidentId:String(meta.incidentId??""),attachmentId:String(meta.attachmentId??""),objectKey:attachment.objectKey,mimeType:attachment.mimeType,sourceAttachmentId:attachment.id,clientMutationId:input.clientMutationId});
  }else{
    filed=await stores.destinations.fileReference({legId,destination:input.destination,destinationId:String(meta.destinationId??""),objectKey:attachment.objectKey,mimeType:attachment.mimeType,fileName:attachment.fileName,sourceAttachmentId:attachment.id});
  }
  const provenance=await stores.filing.create({sourceConversationId:attachment.conversationId,sourceMessageId:attachment.messageId,sourceAttachmentId:attachment.id,senderLegId:attachment.uploaderLegId,destination:input.destination,destinationId:filed.destinationId,objectKey:attachment.objectKey,adminActor:input.adminActor,clientMutationId:input.clientMutationId});
  if(attachment.uploaderLegId){
    const label=meta.label?`Your file was added to ${String(meta.label)}.`:`Your file was added to the leg record.`;
    await stores.notifications.create({legId:attachment.uploaderLegId,kind:"attachment_filed",title:title(input.destination),body:label,actionRequired:false,sourceType:"attachment_filing",sourceId:provenance.id});
  }
  return provenance;
}

const schemaSql=sql.raw(`
create extension if not exists pgcrypto;
create table if not exists manager_attachment_filings(
 id uuid primary key default gen_random_uuid(),
 source_conversation_id uuid not null references manager_conversations(id) on delete cascade,
 source_message_id uuid references manager_messages(id) on delete set null,
 source_attachment_id uuid not null references manager_message_attachments(id) on delete restrict,
 sender_leg_id uuid,
 destination text not null check(destination in('expense_receipt','incident_photo','equipment_handoff_photo','general_leg_document')),
 destination_id text not null,
 object_key text not null,
 admin_actor text not null,
 client_mutation_id uuid not null unique,
 created_at timestamptz not null default now()
);
create index if not exists manager_attachment_filings_source_idx on manager_attachment_filings(source_attachment_id,created_at desc);
create table if not exists manager_attachment_record_refs(
 id uuid primary key default gen_random_uuid(),
 leg_id uuid not null,
 destination text not null check(destination in('equipment_handoff_photo','general_leg_document')),
 destination_id text not null,
 source_attachment_id uuid not null references manager_message_attachments(id) on delete restrict,
 object_key text not null,
 mime_type text,
 file_name text,
 created_at timestamptz not null default now(),
 unique(destination,destination_id,source_attachment_id)
);
`);
function resultRows<T>(v:unknown):T[]{return ((v as {rows?:T[]}).rows??[]) as T[];}
export class AttachmentFilingRepository implements FilingProvenanceStore{
 constructor(private readonly database:DrizzleDatabase){}
 async ensureSchema(){await this.database.execute(schemaSql);}
 private normalize(row:any):AttachmentFiling{return {...row,createdAt:row.createdAt instanceof Date?row.createdAt:new Date(row.createdAt)};}
 async findByMutation(id:string){await this.ensureSchema();const r=await this.database.execute(sql`select id,source_conversation_id as "sourceConversationId",source_message_id as "sourceMessageId",source_attachment_id as "sourceAttachmentId",sender_leg_id as "senderLegId",destination,destination_id as "destinationId",object_key as "objectKey",admin_actor as "adminActor",client_mutation_id as "clientMutationId",created_at as "createdAt" from manager_attachment_filings where client_mutation_id=${id}::uuid limit 1`);const row=resultRows<any>(r)[0];return row?this.normalize(row):null;}
 async create(input:Omit<AttachmentFiling,"id"|"createdAt">){await this.ensureSchema();const r=await this.database.execute(sql`insert into manager_attachment_filings(source_conversation_id,source_message_id,source_attachment_id,sender_leg_id,destination,destination_id,object_key,admin_actor,client_mutation_id) values(${input.sourceConversationId}::uuid,${input.sourceMessageId}::uuid,${input.sourceAttachmentId}::uuid,${input.senderLegId}::uuid,${input.destination},${input.destinationId},${input.objectKey},${input.adminActor},${input.clientMutationId}::uuid) on conflict(client_mutation_id) do nothing returning id`);const id=resultRows<{id:string}>(r)[0]?.id;return (id?await this.findByMutation(input.clientMutationId):await this.findByMutation(input.clientMutationId))!;}
}

export class AttachmentFilingDestinationRepository implements FilingDestinationStore{
 constructor(private readonly database:DrizzleDatabase){}
 private async ensureRefs(){await this.database.execute(schemaSql);}
 async fileExpenseReceipt(input:any){
   const belongs=await this.database.execute(sql`select id from leg_expenses where id=${input.expenseId}::uuid and leg_id=${input.legId}::uuid limit 1`);if(!resultRows(belongs)[0])throw Object.assign(new Error("Expense is outside the selected leg"),{code:"FORBIDDEN"});
   await this.database.execute(sql`insert into leg_receipts(id,leg_id,expense_id,client_mutation_id,mime_type,image_status,object_key) values(${input.receiptId}::uuid,${input.legId}::uuid,${input.expenseId}::uuid,${input.clientMutationId}::uuid,${input.mimeType},'image_uploaded',${input.objectKey}) on conflict(leg_id,client_mutation_id) do update set object_key=excluded.object_key,mime_type=excluded.mime_type,image_status='image_uploaded',updated_at=now()`);
   return {destinationType:"expense_receipt",destinationId:input.receiptId,objectKey:input.objectKey};
 }
 async fileIncidentPhoto(input:any){
   const belongs=await this.database.execute(sql`select id from leg_incidents where id=${input.incidentId}::uuid and leg_id=${input.legId}::uuid limit 1`);if(!resultRows(belongs)[0])throw Object.assign(new Error("Incident is outside the selected leg"),{code:"FORBIDDEN"});
   await this.database.execute(sql`insert into leg_incident_attachments(id,leg_id,incident_id,client_mutation_id,mime_type,image_status,object_key) values(${input.attachmentId}::uuid,${input.legId}::uuid,${input.incidentId}::uuid,${input.clientMutationId}::uuid,${input.mimeType},'image_uploaded',${input.objectKey}) on conflict(leg_id,client_mutation_id) do update set object_key=excluded.object_key,mime_type=excluded.mime_type,image_status='image_uploaded',updated_at=now()`);
   return {destinationType:"incident_photo",destinationId:input.attachmentId,objectKey:input.objectKey};
 }
 async fileReference(input:any){await this.ensureRefs();await this.database.execute(sql`insert into manager_attachment_record_refs(leg_id,destination,destination_id,source_attachment_id,object_key,mime_type,file_name) values(${input.legId}::uuid,${input.destination},${input.destinationId},${input.sourceAttachmentId}::uuid,${input.objectKey},${input.mimeType},${input.fileName}) on conflict(destination,destination_id,source_attachment_id) do nothing`);return {destinationType:input.destination,destinationId:input.destinationId,objectKey:input.objectKey};}
}
