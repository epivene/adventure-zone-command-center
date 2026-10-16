import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireOwnerMiddleware } from "../lib/auth";
import { DeadlineRulesService, type Database } from "../features/deadline-rules/service";
import { readDeadlines } from "../features/deadline-rules/sources";
import { day, offsets, ruleSchema } from "../features/deadline-rules/model";

export function createDeadlineRulesRouter(database: Database = pool) {
  const router=Router();
  router.use("/deadline-rules",requireOwnerMiddleware);
  const service=new DeadlineRulesService(database,process.env.DEADLINE_EMAIL_ENABLED==="true");
  const wrap=(run:(req:any,res:any)=>Promise<void>)=>async(req:any,res:any)=>{
    try { await run(req,res); }
    catch(error) {
      if(error instanceof z.ZodError) { res.status(400).json({error:"Check the date, reminder days, and rule fields."}); return; }
      req.log?.error({err:error},"Deadline rules request failed");
      res.status(500).json({error:"Could not load or save reminders. Please try again."});
    }
  };
  const invalidate=()=>database.query("UPDATE deadline_evaluation_state SET last_evaluated_at=NULL WHERE id=1");
  router.post("/deadline-rules/evaluate",wrap(async(_req,res)=>{res.json(await service.evaluate());}));
  router.get("/deadline-rules/badge",wrap(async(_req,res)=>{res.json(await service.badge());}));
  router.get("/deadline-rules/summary",wrap(async(_req,res)=>{res.json(await service.summary());}));
  router.get("/deadline-rules",wrap(async(_req,res)=>{
    const rules=await database.query("SELECT * FROM deadline_rules ORDER BY created_at,id");
    res.json({rules:rules.rows,email:{enabled:process.env.DEADLINE_EMAIL_ENABLED==="true",providerConfigured:false}});
  }));
  router.post("/deadline-rules",wrap(async(req,res)=>{
    const input=ruleSchema.parse(req.body);
    const result=await database.query("INSERT INTO deadline_rules(name,enabled,trigger,actions) VALUES($1,$2,$3::jsonb,$4::jsonb) RETURNING *",
      [input.name,input.enabled,JSON.stringify(input.trigger),JSON.stringify(input.actions)]);
    await invalidate();res.status(201).json(result.rows[0]);
  }));
  router.put("/deadline-rules/:id",wrap(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id), input=ruleSchema.parse(req.body);
    const result=await database.query("UPDATE deadline_rules SET name=$2,enabled=$3,trigger=$4::jsonb,actions=$5::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
      [id,input.name,input.enabled,JSON.stringify(input.trigger),JSON.stringify(input.actions)]);
    if(!result.rows.length){res.status(404).json({error:"Rule not found."});return;}
    await invalidate();res.json(result.rows[0]);
  }));
  router.post("/deadline-rules/notifications/:id/dismiss",wrap(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id);
    const result=await database.query("UPDATE deadline_notifications SET dismissed_at=now() WHERE id=$1 RETURNING id",[id]);
    if(!result.rows.length){res.status(404).json({error:"Reminder not found."});return;}
    res.json({ok:true});
  }));
  router.get("/deadline-rules/profiles/:id",wrap(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id);
    res.json({items:await readDeadlines(database,id)});
  }));
  router.post("/deadline-rules/profiles/:id",wrap(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id);
    const input=z.object({kind:z.enum(["event","vendor","balance_due","next_action"]),label:z.string().trim().min(1).max(160),dueOn:day.nullable()}).strict().parse(req.body);
    const profile=await database.query("SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",[id]);
    if(!profile.rows.length){res.status(404).json({error:"Profile not found."});return;}
    if(input.kind==="next_action" && input.dueOn) {
      const result=await database.query("INSERT INTO follow_ups(organization_id,kind,due_at) VALUES($1,$2,($3::date+time '09:00') AT TIME ZONE 'America/Denver') RETURNING id",[id,input.label,input.dueOn]);
      await invalidate();res.status(201).json(result.rows[0]);return;
    }
    const result=await database.query("INSERT INTO profile_deadlines(organization_id,kind,label,due_on) VALUES($1,$2,$3,$4) RETURNING id",[id,input.kind,input.label,input.dueOn]);
    await invalidate();res.status(201).json(result.rows[0]);
  }));
  router.put("/deadline-rules/profiles/:id/item",wrap(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id);
    const input=z.object({sourceKey:z.string().max(200),dueOn:day.nullable().optional(),offsets:offsets.nullable(),completed:z.boolean()}).strict().parse(req.body);
    const item=(await readDeadlines(database,id)).find(d=>d.sourceKey===input.sourceKey);
    if(!item){res.status(404).json({error:"Dated item not found."});return;}
    if(input.dueOn!==undefined && !item.editable){res.status(400).json({error:"Edit this date on its original booking, invoice, edition, or follow-up."});return;}
    const tx=await database.connect();
    try{
      await tx.query("BEGIN");
      if(input.dueOn!==undefined){
        if(item.sourceKey.startsWith("application:")) await tx.query("UPDATE organizations SET application_deadline=$2,updated_at=now() WHERE id=$1",[id,input.dueOn]);
        else await tx.query("UPDATE profile_deadlines SET due_on=$3,updated_at=now() WHERE id=$1 AND organization_id=$2",[item.sourceKey.slice(7),id,input.dueOn]);
      }
      const date=input.dueOn===undefined?item.dueOn:input.dueOn;
      await tx.query(`INSERT INTO deadline_preferences(source_key,organization_id,reminder_offsets,completed_for_date) VALUES($1,$2,$3,$4)
        ON CONFLICT(source_key) DO UPDATE SET reminder_offsets=excluded.reminder_offsets,completed_for_date=excluded.completed_for_date,updated_at=now()`,
        [item.sourceKey,id,input.offsets,input.completed?date:null]);
      await tx.query("UPDATE deadline_evaluation_state SET last_evaluated_at=NULL WHERE id=1");
      await tx.query("COMMIT");
    }catch(error){await tx.query("ROLLBACK");throw error;}finally{tx.release();}
    res.json({ok:true});
  }));
  return router;
}
