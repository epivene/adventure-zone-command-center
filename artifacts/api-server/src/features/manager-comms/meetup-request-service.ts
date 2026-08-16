import type { ManualApprovedHandoffInput } from "./manual-handoff-repository";

export interface MeetupRequestStore {
  findByMutation(legId:string,clientMutationId:string):Promise<any|null>;
  create(input:any):Promise<any>;
  get(id:string):Promise<any|null>;
  markApproved(id:string,handoffId:string,adminNotes?:string|null):Promise<any>;
  markDismissed(id:string,reason:string|null):Promise<any>;
}
export interface ManualHandoffStore { createApprovedManual(input:ManualApprovedHandoffInput):Promise<any>; }
export interface MeetupNotificationStore { create(input:any):Promise<any>; }

export async function createMeetupRequest(requests:MeetupRequestStore,notifications:MeetupNotificationStore,input:any){
 const existing=await requests.findByMutation(input.requestingLegId,input.clientMutationId);if(existing)return existing;
 const saved=await requests.create(input);
 await notifications.create({legId:input.requestingLegId,kind:"request_update",title:"Meetup request sent",body:"Admin will review your proposed meetup / equipment swap.",actionRequired:false,sourceType:"meetup_request",sourceId:saved.id});
 return saved;
}
export async function approveMeetupRequest(requests:MeetupRequestStore,handoffs:ManualHandoffStore,notifications:MeetupNotificationStore,requestId:string,edits:{fromLegId:string;toLegId:string;resourceId:string;meetupLabel:string;meetupLatitude:number;meetupLongitude:number;windowStartsAt:Date;windowEndsAt:Date;adminNotes:string|null}){
 const request=await requests.get(requestId);if(!request||request.status!=="pending_admin")throw Object.assign(new Error("Meetup request is not pending"),{code:"NOT_FOUND"});
 if(edits.fromLegId===edits.toLegId)throw Object.assign(new Error("Meetup must involve two different legs"),{code:"INVALID"});
 const handoff=await handoffs.createApprovedManual({...edits,sourceRequestId:requestId});
 const updated=await requests.markApproved(requestId,handoff.id,edits.adminNotes);
 for(const legId of new Set([edits.fromLegId,edits.toLegId]))await notifications.create({legId,kind:"request_update",title:"Meetup approved",body:`${edits.meetupLabel} · ${edits.windowStartsAt.toLocaleString()}–${edits.windowEndsAt.toLocaleTimeString()}`,actionRequired:false,sourceType:"meetup_request",sourceId:requestId});
 return {request:updated,handoff};
}
export async function dismissMeetupRequest(requests:MeetupRequestStore,notifications:MeetupNotificationStore,requestId:string,reason:string|null){
 const request=await requests.get(requestId);if(!request||request.status!=="pending_admin")throw Object.assign(new Error("Meetup request is not pending"),{code:"NOT_FOUND"});
 const updated=await requests.markDismissed(requestId,reason);
 await notifications.create({legId:request.requestingLegId,kind:"request_update",title:"Meetup request closed",body:reason,actionRequired:false,sourceType:"meetup_request",sourceId:requestId});return updated;
}
