import { Router,type Request,type Response,type RequestHandler } from "express";
import { requireOwnerMiddleware } from "@/lib/auth";
import { db } from "@/db/client";
import { BookingDateRepairService } from "@/features/booking-date-repair/date-repair-service";
import { repairProposalSchema,repairApplySchema,repairQueueSchema } from "@/features/booking-date-repair/date-repair-dto";
type Service=Pick<BookingDateRepairService,"queue"|"preview"|"apply">;
const actor=(req:Request)=>{
 const authenticated=(req as Request&{userId?:string}).userId;
 if(typeof authenticated!=="string")throw Object.assign(new Error("OWNER_ACTOR_REQUIRED"),{status:403,code:"OWNER_ACTOR_REQUIRED"});
 // Existing owner password auth deliberately uses a blank legacy actor namespace.
 return authenticated||"single-owner";
};
const error=(res:Response,err:unknown)=>{
 const e=err as {status?:number;code?:string};
 const status=e.status&&e.status>=400&&e.status<500?e.status:500;
 res.status(status).json({code:status===500?"DATE_REPAIR_UNAVAILABLE":e.code??"DATE_REPAIR_REJECTED",
  error:status===500?"Date repair could not be completed. Your draft is preserved.":e.code??"Date repair rejected"});
};
export function createBookingDateRepairsRouter(service:Service=new BookingDateRepairService(db),authorize:RequestHandler=requireOwnerMiddleware){
 const router=Router(),path="/event-date-coverage/booking-date-repairs";
 // Path-local middleware avoids changing authentication on unrelated public routes.
 router.use(path,authorize);
 router.get(path,async(req,res)=>{
  const parsed=repairQueueSchema.safeParse(req.query);if(!parsed.success){res.status(400).json({error:"Invalid review queue filters"});return;}
  try{actor(req);res.json(await service.queue(parsed.data));}catch(e){error(res,e);}
 });
 router.post(path+"/preview",async(req,res)=>{
  const parsed=repairProposalSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:"Invalid date repair proposal"});return;}
  try{res.status(201).json(await service.preview(parsed.data,actor(req)));}catch(e){error(res,e);}
 });
 router.post(path+"/apply",async(req,res)=>{
  const parsed=repairApplySchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:"Invalid date repair apply input"});return;}
  try{res.json(await service.apply(parsed.data,actor(req)));}catch(e){error(res,e);}
 });
 return router;
}
