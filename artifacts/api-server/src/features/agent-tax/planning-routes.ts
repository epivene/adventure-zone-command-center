import type express from "express";
import { z } from "zod";
import { deleteTaxEntry } from "./model";
import { AgentTaxPlanningService } from "./planning-service";
import { estimateYear, payItemInput, payPaymentInput, saveEstimateSettings, updatePayItem } from "./planning-model";
type Run = (action:(req:express.Request,res:express.Response)=>Promise<void>)=>express.RequestHandler;
export function registerTaxPlanningRoutes(router:express.Router,service:AgentTaxPlanningService,run:Run) {
  const root="/admin/agent-tax";
  const uuid=(req:express.Request,res:express.Response)=>{
    const parsed=z.string().uuid().safeParse(req.params.id);
    if(!parsed.success) {res.status(400).json({error:"Invalid pay entry ID."});return null;}
    return parsed.data;
  };
  router.get(`${root}/pay/export`,run(async(_req,res)=>{
    res.type("text/csv").attachment("booking-agent-pay-owed.csv").send(await service.csv());
  }));
  router.get(`${root}/pay`,run(async(req,res)=>{
    const p=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).safeParse(req.query);
    if(!p.success){res.status(400).json({error:"Invalid pay-list page."});return;}
    res.json(await service.list(p.data.page,p.data.limit));
  }));
  router.post(`${root}/pay`,run(async(req,res)=>{
    const p=payItemInput.safeParse(req.body);
    if(!p.success){res.status(400).json({error:"Enter a title, positive amount, earned date and valid optional due date."});return;}
    res.status(201).json({item:await service.create(p.data)});
  }));
  router.patch(`${root}/pay/:id`,run(async(req,res)=>{
    const id=uuid(req,res);if(!id)return;
    const p=updatePayItem.safeParse(req.body);
    if(!p.success){res.status(400).json({error:"Check pay entry fields and version."});return;}
    res.json({item:await service.update(id,p.data,p.data.expectedRevision)});
  }));
  router.delete(`${root}/pay/:id`,run(async(req,res)=>{
    const id=uuid(req,res);if(!id)return;
    const p=deleteTaxEntry.safeParse(req.body);
    if(!p.success){res.status(400).json({error:"Confirm deletion and supply the current version."});return;}
    res.json(await service.remove(id,p.data.expectedRevision));
  }));
  router.post(`${root}/pay/:id/payments`,run(async(req,res)=>{
    const id=uuid(req,res);if(!id)return;
    const p=payPaymentInput.safeParse(req.body);
    if(!p.success){res.status(400).json({error:"Enter a positive received amount, date, payment method and current pay-entry version."});return;}
    res.status(201).json(await service.receive(id,p.data));
  }));
  router.get(`${root}/estimate/:year`,run(async(req,res)=>{
    const y=estimateYear.safeParse(req.params.year);
    if(!y.success){res.status(400).json({error:"Tax estimates are supported only for 2025 and 2026."});return;}
    res.json(await service.estimate(y.data));
  }));
  router.put(`${root}/estimate/:year`,run(async(req,res)=>{
    const y=estimateYear.safeParse(req.params.year),p=saveEstimateSettings.safeParse(req.body);
    if(!y.success || !p.success){res.status(400).json({error:"Choose 2025/2026, a filing status, confirm full-year ND residence, and check monetary amounts."});return;}
    res.json(await service.saveEstimate(y.data,p.data.settings,p.data.expectedRevision));
  }));
}
