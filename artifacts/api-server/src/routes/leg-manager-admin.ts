import { Router,type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { hashLegManagerPassword } from "@/features/leg-manager/leg-manager-auth";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { DrizzleScheduleIssueRepository } from "@/features/leg-manager/schedule-issue-repository";
import { DrizzleFinanceRepository } from "@/features/leg-manager/finance-repository";
const router:IRouter=Router(),repo=new DrizzleLegManagerRepository(db);const access=z.object({password:z.string().min(1),managerName:z.string().trim().max(100).optional().nullable()});
router.get("/manager-admin/legs/access",async(_req,res)=>{res.json({legs:await repo.listAdminStatuses()});});
router.put("/manager-admin/legs/:legId/access",async(req,res):Promise<void>=>{const p=access.safeParse(req.body);if(!p.success){res.status(400).json({error:"Invalid manager access"});return;}const {hash,salt}=await hashLegManagerPassword(p.data.password);const a=await repo.setPassword({legId:req.params.legId,passwordHash:hash,passwordSalt:salt,managerName:p.data.managerName??null});if(!a){res.status(409).json({error:"Manager access can only be enabled for an active travel leg"});return;}res.json({ok:true,access:{legId:a.legId,legName:a.legName,managerName:a.managerName,enabled:true,sessionVersion:a.sessionVersion}});});
router.post("/manager-admin/legs/:legId/sign-out-all",async(req,res):Promise<void>=>{if(!(await repo.incrementSessionVersion(req.params.legId))){res.status(404).json({error:"Manager access has not been configured for this leg"});return;}res.json({ok:true});});

router.get("/manager-admin/issues",async(req,res)=>{res.json({issues:await new DrizzleScheduleIssueRepository(db).list(typeof req.query.status==="string"?req.query.status:"open")});});
router.post("/manager-admin/issues/:id/resolve",async(req,res):Promise<void>=>{const p=z.object({resolutionNote:z.string().trim().min(1).max(4000)}).safeParse(req.body);if(!p.success){res.status(400).json({error:"Resolution note is required"});return;}const issue=await new DrizzleScheduleIssueRepository(db).resolve(req.params.id,p.data.resolutionNote);if(!issue){res.status(404).json({error:"Issue not found"});return;}res.json({issue});});

router.get("/manager-admin/legs/:legId/money/summary",async(req,res)=>{res.json(await new DrizzleFinanceRepository(db).summary(req.params.legId,typeof req.query.tripId==="string"?req.query.tripId:null));});
router.get("/manager-admin/money/summary",async(req,res)=>{res.json(await new DrizzleFinanceRepository(db).summary(null,typeof req.query.tripId==="string"?req.query.tripId:null));});

export default router;
