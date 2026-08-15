import { and, desc, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { bookings, legScheduleIssues, trips } from "@/db/schema";
export const scheduleIssueKinds=["wrong_datetime","wrong_location","wrong_leg","route_problem","event_details_changed","other"] as const;
export type ScheduleIssueKind=typeof scheduleIssueKinds[number];
export type CreateScheduleIssueInput={legId:string;bookingId:string|null;tripId:string|null;kind:ScheduleIssueKind;notes:string;clientMutationId:string};
export interface ScheduleIssueStore{findByMutation(legId:string,id:string):Promise<any|null>;bookingBelongsToLeg(id:string,legId:string):Promise<boolean>;tripBelongsToLeg(id:string,legId:string):Promise<boolean>;insert(input:CreateScheduleIssueInput):Promise<any>}
export async function createScheduleIssue(store:ScheduleIssueStore,input:CreateScheduleIssueInput):Promise<any>{const existing=await store.findByMutation(input.legId,input.clientMutationId);if(existing)return {ok:true,issue:existing,idempotent:true};if(input.bookingId&&!(await store.bookingBelongsToLeg(input.bookingId,input.legId)))return {ok:false,code:"CROSS_LEG_REFERENCE"};if(input.tripId&&!(await store.tripBelongsToLeg(input.tripId,input.legId)))return {ok:false,code:"CROSS_LEG_REFERENCE"};return {ok:true,issue:await store.insert(input),idempotent:false};}
type DB=typeof database;
export class DrizzleScheduleIssueRepository implements ScheduleIssueStore{constructor(private readonly db:DB){}
  async findByMutation(legId:string,id:string){const [r]=await this.db.select().from(legScheduleIssues).where(and(eq(legScheduleIssues.legId,legId),eq(legScheduleIssues.clientMutationId,id))).limit(1);return r??null}
  async bookingBelongsToLeg(id:string,legId:string){const [r]=await this.db.select({id:bookings.id}).from(bookings).where(and(eq(bookings.id,id),eq(bookings.travelLegId,legId))).limit(1);return !!r}
  async tripBelongsToLeg(id:string,legId:string){const [r]=await this.db.select({id:trips.id}).from(trips).where(and(eq(trips.id,id),eq(trips.travelLegId,legId))).limit(1);return !!r}
  async insert(i:CreateScheduleIssueInput){const [r]=await this.db.insert(legScheduleIssues).values(i).onConflictDoNothing({target:[legScheduleIssues.legId,legScheduleIssues.clientMutationId]}).returning();if(r)return r;const existing=await this.findByMutation(i.legId,i.clientMutationId);if(!existing)throw new Error("Schedule issue could not be saved");return existing}
  create(i:CreateScheduleIssueInput){return createScheduleIssue(this,i)}
  list(status="open"){return this.db.select().from(legScheduleIssues).where(eq(legScheduleIssues.status,status)).orderBy(desc(legScheduleIssues.createdAt))}
  async resolve(id:string,note:string){const [r]=await this.db.update(legScheduleIssues).set({status:"resolved",resolutionNote:note,resolvedAt:new Date(),updatedAt:new Date()}).where(eq(legScheduleIssues.id,id)).returning();return r??null}
}
