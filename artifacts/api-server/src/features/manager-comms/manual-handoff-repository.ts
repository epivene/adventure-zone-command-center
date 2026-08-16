import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { HandoffRepository } from "@/features/routes/handoff-repository";

type DrizzleDatabase=typeof database;
export type ManualApprovedHandoffInput={fromLegId:string;toLegId:string;resourceId:string;meetupLabel:string;meetupLatitude:number;meetupLongitude:number;windowStartsAt:Date;windowEndsAt:Date;adminNotes:string|null;sourceRequestId:string};
export class ManualHandoffRepository{
 private readonly handoffs:HandoffRepository;
 constructor(private readonly database:DrizzleDatabase){this.handoffs=new HandoffRepository(database);}
 async createApprovedManual(input:ManualApprovedHandoffInput){
  const dependencyFingerprint=createHash("sha256").update(JSON.stringify(["manager-request",input.sourceRequestId,input.fromLegId,input.toLegId,input.resourceId,input.meetupLabel,input.meetupLatitude,input.meetupLongitude,input.windowStartsAt.toISOString(),input.windowEndsAt.toISOString()])).digest("hex");
  const suggestion=await this.handoffs.upsertSuggestion({fromLegId:input.fromLegId,toLegId:input.toLegId,fromTripId:null,toTripId:null,resourceId:input.resourceId,meetupLabel:input.meetupLabel,meetupLatitude:input.meetupLatitude,meetupLongitude:input.meetupLongitude,windowStartsAt:input.windowStartsAt,windowEndsAt:input.windowEndsAt,directMiles:null,directMinutes:null,fromDetourMiles:0,fromDetourMinutes:0,toDetourMiles:0,toDetourMinutes:0,combinedDetourMiles:0,availableBufferMinutes:Math.max(0,(input.windowEndsAt.getTime()-input.windowStartsAt.getTime())/60000),opportunityBand:"possible",explanation:input.adminNotes?`Manager-requested equipment meetup. ${input.adminNotes}`:"Manager-requested equipment meetup approved by admin.",dependencyFingerprint});
  const approved=await this.handoffs.approve(suggestion.id);
  if(approved)return approved;
  const existing=await this.handoffs.get(suggestion.id);
  if(existing?.status==="approved")return existing;
  throw new Error("Approved handoff could not be created");
 }
}
