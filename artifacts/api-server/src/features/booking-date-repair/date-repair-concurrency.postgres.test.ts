import { beforeEach,afterEach,describe,it,expect } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { planningFixtureSql } from "../leg-planning/planning-test-database";
import { repairFixtureSql,proposal,noteId } from "./date-repair-test-setup";
import { BookingDateRepairService } from "./date-repair-service";
const url=process.env.LEG_PLANNING_TEST_DATABASE_URL;
if(url){const u=new URL(url);if(!["localhost","127.0.0.1","[::1]"].includes(u.hostname)||!u.pathname.startsWith("/leg_planning_test"))throw new Error("Disposable loopback test database required");}
describe.skipIf(!url)("PostgreSQL date repair serialization",()=>{
 let admin:pg.Pool,pool:pg.Pool,schema:string,service:BookingDateRepairService;
 beforeEach(async()=>{admin=new pg.Pool({connectionString:url});schema="date_repair_"+randomUUID().replaceAll("-","");
 await admin.query("CREATE SCHEMA "+schema);pool=new pg.Pool({connectionString:url,options:"-c search_path="+schema+",public",max:4});
 await pool.query(planningFixtureSql+repairFixtureSql+"CREATE TABLE outreach_candidates(checked_at timestamptz,source_snapshot jsonb);");
 for(const name of ["20261001_leg_planning.sql","20261002_booking_date_provenance.sql"])await pool.query(await readFile(new URL("../../../../../lib/db/migrations/"+name,import.meta.url),"utf8"));
 service=new BookingDateRepairService(drizzle(pool) as never);});
 afterEach(async()=>{await pool?.end();if(schema)await admin.query("DROP SCHEMA "+schema+" CASCADE");await admin?.end();});
 it("allows one simultaneous apply and rejects the stale competitor, with one immutable receipt",async()=>{
 const a=await service.preview(proposal() as never,"owner"),b=await service.preview(proposal() as never,"owner");
 const results=await Promise.allSettled([service.apply({previewId:a.id,fingerprint:a.fingerprint,requestKey:"a"},"owner"),service.apply({previewId:b.id,fingerprint:b.fingerprint,requestKey:"b"},"owner")]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 const failed=results.find(r=>r.status==="rejected") as PromiseRejectedResult;
 expect(failed.reason).toMatchObject({status:409});
 expect((await pool.query("SELECT count(*)::int n FROM booking_date_repair_receipts")).rows[0].n).toBe(1);
 await expect(pool.query("UPDATE booking_date_repair_receipts SET reason='tampered'")).rejects.toThrow("BOOKING_DATE_HISTORY_IMMUTABLE");
 },30000);
 it("locks mutable source proof and rejects a source revision changed during the competing write",async()=>{
 const preview=await service.preview(proposal() as never,"owner");const sourceWriter=await pool.connect();
 try{await sourceWriter.query("BEGIN");await sourceWriter.query("UPDATE activities SET body=body || ' source changed' WHERE id=$1",[noteId]);
 const apply=service.apply({previewId:preview.id,fingerprint:preview.fingerprint,requestKey:"source-race"},"owner");
 // The source writer already holds the row lock; apply must read its committed revision.
 await sourceWriter.query("COMMIT");await expect(apply).rejects.toMatchObject({status:409});
 expect((await pool.query("SELECT count(*)::int n FROM booking_date_repair_receipts")).rows[0].n).toBe(0);
 }finally{await sourceWriter.query("ROLLBACK");sourceWriter.release();}
 },30000);
});
