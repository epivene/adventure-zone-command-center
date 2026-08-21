import { and, count, desc, eq, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { officeEmailDrafts, officeTasks, organizations } from "@/db/schema";

type DrizzleDatabase=typeof database;
export type OfficeCoordinatorAttention={needsHelpCount:number;submittedDraftCount:number;needsHelpTasks:Array<{id:string;title:string;profileId:string|null;profileName:string|null;updatedAt:string}>;submittedDrafts:Array<{id:string;profileId:string;profileName:string;recipientEmail:string;subject:string;submittedAt:string}>};
export const emptyOfficeCoordinatorAttention=():OfficeCoordinatorAttention=>({needsHelpCount:0,submittedDraftCount:0,needsHelpTasks:[],submittedDrafts:[]});

export async function loadOfficeCoordinatorAttention(database:DrizzleDatabase):Promise<OfficeCoordinatorAttention>{
  const activeHelp=and(eq(officeTasks.needsHelp,true),sql`${officeTasks.status} not in ('done','cancelled')`);
  const [[helpTotal],[draftTotal],helpRows,draftRows]=await Promise.all([
    database.select({value:count()}).from(officeTasks).where(activeHelp),
    database.select({value:count()}).from(officeEmailDrafts).where(eq(officeEmailDrafts.state,"submitted")),
    database.select({id:officeTasks.id,title:officeTasks.title,profileId:officeTasks.organizationId,profileName:organizations.name,updatedAt:officeTasks.updatedAt}).from(officeTasks).leftJoin(organizations,eq(organizations.id,officeTasks.organizationId)).where(activeHelp).orderBy(desc(officeTasks.updatedAt)).limit(5),
    database.select({id:officeEmailDrafts.id,profileId:officeEmailDrafts.organizationId,profileName:organizations.name,recipientEmail:officeEmailDrafts.recipientEmail,subject:officeEmailDrafts.subject,submittedAt:officeEmailDrafts.submittedAt}).from(officeEmailDrafts).innerJoin(organizations,eq(organizations.id,officeEmailDrafts.organizationId)).where(eq(officeEmailDrafts.state,"submitted")).orderBy(desc(officeEmailDrafts.submittedAt)).limit(5),
  ]);
  return {needsHelpCount:Number(helpTotal?.value??0),submittedDraftCount:Number(draftTotal?.value??0),needsHelpTasks:helpRows.map((row)=>({id:row.id,title:row.title,profileId:row.profileId,profileName:row.profileName,updatedAt:row.updatedAt.toISOString()})),submittedDrafts:draftRows.flatMap((row)=>row.submittedAt?[{id:row.id,profileId:row.profileId,profileName:row.profileName,recipientEmail:row.recipientEmail,subject:row.subject,submittedAt:row.submittedAt.toISOString()}]:[])};
}
