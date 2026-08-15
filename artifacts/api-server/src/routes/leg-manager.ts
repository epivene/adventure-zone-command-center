import express, { Router,type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { loadLegManagerDashboard } from "@/features/leg-manager/leg-manager-dashboard";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import { DrizzleScheduleIssueRepository, scheduleIssueKinds } from "@/features/leg-manager/schedule-issue-repository";
import { createFinanceMutation, DrizzleFinanceRepository, type FinanceMutationKind } from "@/features/leg-manager/finance-repository";
import { legCashEntryKinds, legExpenseCategories, legPaymentSources } from "@/features/leg-manager/finance-types";
import { z } from "zod";
import { rollupOperations } from "@/features/leg-manager/operations-rollup";
import { createReceiptMetadata,DrizzleReceiptMetadataStore,uploadReceiptImage } from "@/features/leg-manager/receipt-service";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
const router:IRouter=Router();const requireManager=createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));const finance=new DrizzleFinanceRepository(db);
async function data(req:any,res:any){const result=await loadLegManagerDashboard(new DrizzleTripRepository(db),req.legManager.legId);res.json(result);}
router.get("/manager/dashboard",requireManager,data);router.get("/manager/route",requireManager,data);

const refs={bookingId:z.string().uuid().nullable().optional(),tripId:z.string().uuid().nullable().optional(),tripSegmentId:z.string().uuid().nullable().optional(),clientMutationId:z.string().uuid()};
const income=z.object({...refs,cashCents:z.number().int().nonnegative().default(0),squareCents:z.number().int().nonnegative().default(0),otherCents:z.number().int().nonnegative().default(0),otherLabel:z.string().trim().max(120).nullable().optional(),occurredAt:z.coerce.date(),notes:z.string().max(4000).nullable().optional()});
const expense=z.object({...refs,id:z.string().uuid().optional(),category:z.enum(legExpenseCategories),merchant:z.string().trim().max(200).nullable().optional(),amountCents:z.number().int().nonnegative(),taxCents:z.number().int().nonnegative().default(0),paymentSource:z.enum(legPaymentSources),occurredAt:z.coerce.date(),notes:z.string().max(4000).nullable().optional(),employeeNote:z.string().max(1000).nullable().optional(),detailJson:z.record(z.string(),z.unknown()).nullable().optional()});
const cash=z.object({...refs,kind:z.enum(legCashEntryKinds),amountCents:z.number().int(),occurredAt:z.coerce.date(),notes:z.string().max(4000).nullable().optional()}).refine(v=>v.kind==="adjustment"||v.amountCents>=0,{message:"Amount must be nonnegative unless adjustment"});
const mileage=z.object({...refs,miles:z.number().nonnegative().nullable().optional(),odometerStart:z.number().nonnegative().nullable().optional(),odometerEnd:z.number().nonnegative().nullable().optional(),vehicleLabel:z.string().max(160).nullable().optional(),occurredAt:z.coerce.date(),notes:z.string().max(4000).nullable().optional()}).refine(v=>v.miles!=null||(v.odometerStart!=null&&v.odometerEnd!=null&&v.odometerEnd>=v.odometerStart),{message:"Enter miles or valid odometer readings"});
async function post(kind:FinanceMutationKind,schema:any,req:any,res:any){const p=schema.safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.issues[0]?.message??"Invalid finance entry"});return;}const {bookingId=null,tripId=null,tripSegmentId=null,clientMutationId,...payload}=p.data;const result=await createFinanceMutation(finance,kind,{legId:req.legManager.legId,bookingId,tripId,tripSegmentId,clientMutationId,payload});if(!result.ok){res.status(403).json({error:"The referenced booking, trip, or segment is outside your leg"});return;}res.status(result.idempotent?200:201).json(result.row);}
router.get("/manager/money/summary",requireManager,async(req,res)=>res.json(await finance.summary(req.legManager!.legId,typeof req.query.tripId==="string"?req.query.tripId:null)));
router.post("/manager/income",requireManager,(req,res)=>post("income",income,req,res));
router.post("/manager/expenses",requireManager,(req,res)=>post("expense",expense,req,res));
router.post("/manager/cash",requireManager,(req,res)=>post("cash",cash,req,res));
router.post("/manager/mileage",requireManager,(req,res)=>post("mileage",mileage,req,res));

const receiptStore=new DrizzleReceiptMetadataStore(db);const receiptStorage=new GoogleCloudLegManagerObjectStorage();const receiptMeta=z.object({id:z.string().uuid(),expenseId:z.string().uuid(),clientMutationId:z.string().uuid(),mimeType:z.string().max(120).nullable().optional()});
router.post("/manager/receipts",requireManager,async(req,res):Promise<void>=>{const p=receiptMeta.safeParse(req.body);if(!p.success){res.status(400).json({error:"Invalid receipt"});return;}const result=await createReceiptMetadata(receiptStore,{id:p.data.id,legId:req.legManager!.legId,expenseId:p.data.expenseId,clientMutationId:p.data.clientMutationId,mimeType:p.data.mimeType??null});if(!result.ok){res.status(403).json({error:"Expense is outside your leg"});return;}res.status(result.idempotent?200:201).json(result.receipt);});
router.put("/manager/receipts/:receiptId/image",requireManager,express.raw({type:"image/*",limit:"12mb"}),async(req,res):Promise<void>=>{const bytes=req.body instanceof Buffer?new Uint8Array(req.body):new Uint8Array();if(!bytes.length){res.status(400).json({error:"Receipt image is required"});return;}const result=await uploadReceiptImage(receiptStore,receiptStorage,{legId:req.legManager!.legId,receiptId:req.params.receiptId,mimeType:req.headers["content-type"]??"application/octet-stream",bytes});if(!result.ok){res.status(result.error==="OUTSIDE_LEG"?403:503).json({error:result.error});return;}res.json(result.receipt);});

router.get("/manager/operations/segments",requireManager,async(req,res):Promise<void>=>{const tripId=typeof req.query.tripId==="string"?req.query.tripId:"";if(!tripId){res.status(400).json({error:"tripId is required"});return;}if(!(await finance.refsBelongToLeg(req.legManager!.legId,{tripId,bookingId:null,tripSegmentId:null}))){res.status(403).json({error:"Trip is outside your leg"});return;}const tripRepo=new DrizzleTripRepository(db);const segments=await tripRepo.listSegments(tripId);const summary=await finance.summary(req.legManager!.legId,tripId);res.json(rollupOperations(segments,summary.expenses,summary.mileage));});

const issueSchema=z.object({bookingId:z.string().uuid().nullable().optional(),tripId:z.string().uuid().nullable().optional(),kind:z.enum(scheduleIssueKinds),notes:z.string().trim().min(1).max(4000),clientMutationId:z.string().uuid()});
router.post("/manager/issues",requireManager,async(req,res):Promise<void>=>{const p=issueSchema.safeParse(req.body);if(!p.success){res.status(400).json({error:p.error.issues[0]?.message??"Invalid issue report"});return;}const result=await new DrizzleScheduleIssueRepository(db).create({legId:req.legManager!.legId,bookingId:p.data.bookingId??null,tripId:p.data.tripId??null,kind:p.data.kind,notes:p.data.notes,clientMutationId:p.data.clientMutationId});if(!result.ok){res.status(403).json({error:"The referenced booking or trip is outside your leg"});return;}res.status(result.idempotent?200:201).json(result.issue);});

export default router;
