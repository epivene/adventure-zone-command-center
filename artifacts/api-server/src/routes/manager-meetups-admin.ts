import { Router,type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { MeetupRequestRepository } from "@/features/manager-comms/meetup-request-repository";
import { NotificationRepository } from "@/features/manager-comms/notification-repository";
import { ManualHandoffRepository } from "@/features/manager-comms/manual-handoff-repository";
import { AcknowledgmentRepository } from "@/features/manager-comms/acknowledgment-repository";
import { AcknowledgmentService } from "@/features/manager-comms/acknowledgment-service";
import { recordMeetupApprovalAcknowledgment } from "@/features/manager-comms/admin-change-recorder";
import { approveMeetupRequest,dismissMeetupRequest } from "@/features/manager-comms/meetup-request-service";
const router:IRouter=Router();
const requests=new MeetupRequestRepository(db);const notifications=new NotificationRepository(db);const handoffs=new ManualHandoffRepository(db);const acknowledgments=new AcknowledgmentService(new AcknowledgmentRepository(db));
function param(v:string|string[]|undefined){return Array.isArray(v)?v[0]??"":v??"";}
function rows<T>(value:unknown):T[]{return ((value as {rows?:T[]}).rows??[]) as T[];}
const approval=z.object({fromLegId:z.string().uuid(),toLegId:z.string().uuid(),resourceId:z.string().uuid(),meetupLabel:z.string().trim().min(1).max(240),meetupLatitude:z.number().min(-90).max(90),meetupLongitude:z.number().min(-180).max(180),windowStartsAt:z.coerce.date(),windowEndsAt:z.coerce.date(),adminNotes:z.string().trim().max(4000).nullable().optional()}).refine(v=>v.fromLegId!==v.toLegId,{message:"Meetup must use two different legs"}).refine(v=>v.windowEndsAt>=v.windowStartsAt,{message:"End time must be after start time"});
router.get("/manager-admin/meetup-options",async(_req,res)=>{const result=await db.execute(sql`select id,name from resources where movable=true order by name`);res.json({resources:rows(result)});});
router.get("/manager-admin/meetup-requests",async(req,res)=>{const status=typeof req.query.status==="string"?req.query.status:undefined;res.json({requests:await requests.list(status==="pending_admin"||status==="approved"||status==="dismissed"?status:undefined)});});
router.post("/manager-admin/meetup-requests/:id/approve",async(req,res):Promise<void>=>{
  const p=approval.safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.issues[0]?.message??"Invalid meetup approval"});return;}
  const requestId=param(req.params.id);
  try{
    const result=await approveMeetupRequest(requests,handoffs,notifications,requestId,{...p.data,adminNotes:p.data.adminNotes??null});
    const resourceResult=await db.execute(sql`select name from resources where id=${p.data.resourceId}::uuid limit 1`);
    const resourceName=rows<{name:string}>(resourceResult)[0]?.name??"Equipment";
    await recordMeetupApprovalAcknowledgment(acknowledgments,{requestId,handoffId:result.handoff.id,fromLegId:p.data.fromLegId,toLegId:p.data.toLegId,resourceName,meetupLabel:p.data.meetupLabel,windowStartsAt:p.data.windowStartsAt,windowEndsAt:p.data.windowEndsAt,adminActor:"Admin"});
    res.json(result);
  }catch(error){res.status((error as any)?.code==="NOT_FOUND"?404:400).json({error:(error as Error).message});}
});
router.post("/manager-admin/meetup-requests/:id/dismiss",async(req,res):Promise<void>=>{const p=z.object({reason:z.string().trim().max(4000).nullable().optional()}).safeParse(req.body);if(!p.success){res.status(400).json({error:"Invalid dismissal"});return;}try{res.json({request:await dismissMeetupRequest(requests,notifications,param(req.params.id),p.data.reason??null)});}catch(error){res.status(404).json({error:(error as Error).message});}});
export default router;
