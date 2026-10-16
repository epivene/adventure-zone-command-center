import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireOwnerMiddleware } from "@/lib/auth";
import { createTaxStorage } from "@/features/agent-tax/storage";
import { AgentTaxService } from "@/features/agent-tax/service";
import { createTaxEntry, deleteTaxEntry, TaxError, taxFileType, updateTaxEntry } from "@/features/agent-tax/model";

export function createAgentTaxRouter(service?: AgentTaxService, ownerGate: RequestHandler = requireOwnerMiddleware) {
  const router = Router();
  // This explicit boundary rejects Office, Boss, Manager and assistant credentials.
  router.use("/admin/agent-tax", ownerGate, (_req,res,next) => {
    res.set("Cache-Control","private, no-store");
    res.set("X-Content-Type-Options","nosniff");
    next();
  });
  const getService = () => {
    if (!service) {
      const config = createTaxStorage();
      service = new AgentTaxService(pool,config.storage,config.available);
    }
    return service;
  };
  const run = (action: (req: express.Request,res: express.Response) => Promise<void>): RequestHandler => async (req,res) => {
    try { await action(req,res); }
    catch (error) {
      if (error instanceof TaxError) { res.status(error.status).json({error:error.message}); return; }
      const code = (error as {code?:string})?.code;
      if (code === "23503") { res.status(400).json({error:"The linked booking no longer exists. Choose another booking or clear the link."}); return; }
      req.log?.error({errorCode:code || "TAX_RECORD_OPERATION_FAILED"},"Private tax record operation failed");
      res.status(503).json({error:"Could not complete this tax-record request. Your existing records have not been replaced; try again."});
    }
  };
  const id = (req: express.Request) => z.string().uuid().parse(req.params.id);
  const yearSchema = z.coerce.number().int().min(1900).max(2200);
  const params = z.object({year:yearSchema.default(new Date().getFullYear()),q:z.string().trim().max(200).default(""),
    page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)});

  router.get("/admin/agent-tax/records",run(async(req,res) => {
    const input=params.safeParse(req.query);
    if (!input.success) {res.status(400).json({error:"Invalid year or search filters."});return;}
    const p=input.data; res.json(await getService().list(p.year,p.q,p.page,p.limit));
  }));
  router.get("/admin/agent-tax/bookings",run(async(req,res) => {
    const q=z.string().trim().max(200).safeParse(req.query.q ?? "");
    if(!q.success){res.status(400).json({error:"Search must be at most 200 characters."});return;}
    res.json(await getService().bookings(q.data));
  }));
  router.get("/admin/agent-tax/export",run(async(req,res) => {
    const year=yearSchema.safeParse(req.query.year);
    if(!year.success){res.status(400).json({error:"Choose a valid tax year."});return;}
    res.type("text/csv").attachment(`booking-agent-tax-${year.data}.csv`).send(await getService().csv(year.data));
  }));
  router.post("/admin/agent-tax/records",run(async(req,res) => {
    const input=createTaxEntry.safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Enter a title, valid type/category, and tax year. Income/expenses require an amount in cents and a matching date."});return;}
    res.status(201).json({record:await getService().create(input.data)});
  }));
  router.patch("/admin/agent-tax/records/:id",run(async(req,res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {res.status(400).json({error:"Invalid record ID."});return;}
    const input=updateTaxEntry.safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Check the entry fields, tax year, date, amount, and record version."});return;}
    res.json({record:await getService().update(id(req),input.data,input.data.expectedRevision)});
  }));
  router.delete("/admin/agent-tax/records/:id",run(async(req,res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {res.status(400).json({error:"Invalid record ID."});return;}
    const input=deleteTaxEntry.safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Confirm deletion and supply the current record version."});return;}
    res.json(await getService().remove(id(req),input.data.expectedRevision));
  }));
  router.put("/admin/agent-tax/records/:id/file",express.raw({type:()=>true,limit:"15mb"}),run(async(req,res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {res.status(400).json({error:"Invalid record ID."});return;}
    const revision=z.coerce.number().int().positive().safeParse(req.headers["x-record-revision"]);
    let name="";
    try {name=decodeURIComponent(String(req.headers["x-file-name"] ?? "")).replaceAll("\\","/").split("/").at(-1)?.trim() ?? "";} catch {}
    if (!revision.success || !name || name.length>255 || /[\u0000-\u001f]/.test(name)) {res.status(400).json({error:"Choose a filename and the current record version."});return;}
    const bytes=Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if(!bytes.length){res.status(400).json({error:"Choose a non-empty PDF or image."});return;}
    const mime=String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    taxFileType(bytes,mime);
    res.json({record:await getService().upload(id(req),revision.data,name,mime,bytes)});
  }));
  router.get("/admin/agent-tax/records/:id/file",run(async(req,res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {res.status(400).json({error:"Invalid record ID."});return;}
    const file=await getService().download(id(req));
    res.type(file.mime).attachment(file.name).send(Buffer.from(file.bytes));
  }));
  router.delete("/admin/agent-tax/records/:id/file",run(async(req,res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {res.status(400).json({error:"Invalid record ID."});return;}
    const input=deleteTaxEntry.safeParse(req.body);
    if(!input.success){res.status(400).json({error:"Confirm attachment removal and supply the record version."});return;}
    res.json({record:await getService().removeFile(id(req),input.data.expectedRevision)});
  }));
  router.use("/admin/agent-tax", ((err: {type?:string},_req,res,next) => {
    if(err.type==="entity.too.large"){res.status(413).json({error:"Choose a file smaller than 15 MB."});return;}
    next(err);
  }) as express.ErrorRequestHandler);
  return router;
}
