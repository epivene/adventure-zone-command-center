import { Router,type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { loadLegManagerDashboard } from "@/features/leg-manager/leg-manager-dashboard";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import { DrizzleScheduleIssueRepository, scheduleIssueKinds } from "@/features/leg-manager/schedule-issue-repository";
import { z } from "zod";
const router:IRouter=Router();const requireManager=createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
async function data(req:any,res:any){const result=await loadLegManagerDashboard(new DrizzleTripRepository(db),req.legManager.legId);res.json(result);}
router.get("/manager/dashboard",requireManager,data);router.get("/manager/route",requireManager,data);

const issueSchema=z.object({bookingId:z.string().uuid().nullable().optional(),tripId:z.string().uuid().nullable().optional(),kind:z.enum(scheduleIssueKinds),notes:z.string().trim().min(1).max(4000),clientMutationId:z.string().uuid()});
router.post("/manager/issues",requireManager,async(req,res):Promise<void>=>{const p=issueSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.issues[0]?.message??"Invalid issue report"});return;}const result=await new DrizzleScheduleIssueRepository(db).create({legId:req.legManager!.legId,bookingId:p.data.bookingId??null,tripId:p.data.tripId??null,kind:p.data.kind,notes:p.data.notes,clientMutationId:p.data.clientMutationId});if(!result.ok){res.status(403).json({error:"The referenced booking or trip is outside your leg"});return;}res.status(result.idempotent?200:201).json(result.issue);});

export default router;
