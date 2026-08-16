import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { MeetupRequestRepository } from "@/features/manager-comms/meetup-request-repository";
import { NotificationRepository } from "@/features/manager-comms/notification-repository";
import { createMeetupRequest } from "@/features/manager-comms/meetup-request-service";

const router:IRouter=Router();
const requireManager=createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const requests=new MeetupRequestRepository(db);const notifications=new NotificationRepository(db);
function rows<T>(v:unknown):T[]{return ((v as {rows?:T[]}).rows??[]) as T[];}
const input=z.object({otherLegIds:z.array(z.string().uuid()).min(1).max(8),resourceId:z.string().uuid(),meetupLabel:z.string().trim().min(1).max(240),meetupLatitude:z.number().min(-90).max(90),meetupLongitude:z.number().min(-180).max(180),preferredStartsAt:z.coerce.date(),preferredEndsAt:z.coerce.date(),notes:z.string().trim().max(4000).nullable().optional(),linkedConversationId:z.string().uuid().nullable().optional(),linkedMessageId:z.string().uuid().nullable().optional(),clientMutationId:z.string().uuid()}).refine(v=>v.preferredEndsAt>=v.preferredStartsAt,{message:"End time must be after start time"});
router.get("/manager/meetup-options",requireManager,async(_req,res)=>{const r=await db.execute(sql`select id,code,name from resources where active=true and movable=true order by name`);res.json({resources:rows(r)});});
router.get("/manager/meetup-requests",requireManager,async(req,res)=>res.json({requests:await requests.listForLeg(req.legManager!.legId)}));
router.post("/manager/meetup-requests",requireManager,async(req,res):Promise<void>=>{const p=input.safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.issues[0]?.message??"Invalid meetup request"});return;}if(p.data.otherLegIds.includes(req.legManager!.legId)){res.status(400).json({error:"Choose another leg to meet"});return;}const request=await createMeetupRequest(requests,notifications,{requestingLegId:req.legManager!.legId,otherLegIds:p.data.otherLegIds,resourceId:p.data.resourceId,meetupLabel:p.data.meetupLabel,meetupLatitude:p.data.meetupLatitude,meetupLongitude:p.data.meetupLongitude,preferredStartsAt:p.data.preferredStartsAt,preferredEndsAt:p.data.preferredEndsAt,notes:p.data.notes??null,linkedConversationId:p.data.linkedConversationId??null,linkedMessageId:p.data.linkedMessageId??null,clientMutationId:p.data.clientMutationId});res.status(201).json({request});});
export default router;
