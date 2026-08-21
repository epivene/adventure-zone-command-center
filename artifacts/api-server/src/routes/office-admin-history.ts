import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router:IRouter=Router();
type Row={id:string;entityType:string;entityId:string;action:string;after:Record<string,unknown>|null;createdAt:Date};
router.get("/office-admin/history",async(req,res):Promise<void>=>{
  try{
    const result=await db.execute<Row>(sql`
      select id, entity_type as "entityType", entity_id as "entityId", action, after, created_at as "createdAt"
      from audit_entries
      where action in ('office_profile_updated','office_contact_updated','office_location_updated','office_note_created')
      order by created_at desc, id desc
      limit 100
    `);
    res.json({history:(result.rows??[]).map((row)=>({id:row.id,entityType:row.entityType,entityId:row.entityId,action:row.action,after:row.after,createdAt:row.createdAt instanceof Date?row.createdAt.toISOString():String(row.createdAt)}))});
  }catch(error){req.log.error({err:error},"Failed to load Office Coordinator update history");res.status(500).json({error:"Could not load Office Coordinator history."});}
});
export default router;
