import type { AcknowledgmentService } from "./acknowledgment-service";

export async function recordMeetupApprovalAcknowledgment(
  acknowledgments: Pick<AcknowledgmentService,"recordAdminOperationalChange">,
  input:{
    requestId:string; handoffId:string; fromLegId:string; toLegId:string; resourceName:string; meetupLabel:string;
    windowStartsAt:Date; windowEndsAt:Date; adminActor:string;
  },
){
  return acknowledgments.recordAdminOperationalChange({
    actionId:input.requestId,
    legIds:[input.fromLegId,input.toLegId],
    actor:input.adminActor,
    sourceType:"equipment_handoff",
    sourceId:input.handoffId,
    title:"Equipment meetup approved",
    items:[
      {label:"Equipment",beforeValue:null,afterValue:input.resourceName},
      {label:"Meetup",beforeValue:null,afterValue:input.meetupLabel},
      {label:"Window",beforeValue:null,afterValue:`${input.windowStartsAt.toLocaleString()} – ${input.windowEndsAt.toLocaleString()}`},
    ],
  });
}
