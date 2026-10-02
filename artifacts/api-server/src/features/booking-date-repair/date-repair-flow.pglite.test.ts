import { it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { DrizzleApplyRepository } from "../act-replacement/drizzle-apply-repository";
import { loadPlanFacts } from "../leg-planning/planning-facts";
import { actors } from "../leg-planning/planning-fixtures";
import { BookingDateRepairService } from "./date-repair-service";
import { repairDatabase,proposal,ids,noteId,orgId } from "./date-repair-test-setup";
it("carries a signed ACT sales import through owner source review and repair without changing status, packages or history",async()=>{
 const {pg,db}=await repairDatabase();try{
 const source=randomUUID(),version=randomUUID(),batch=randomUUID();
 const raw={estimatedCloseDate:"2026-04-01T12:00:00Z",actualCloseDate:"9999-12-31T00:00:00Z"};
 await pg.exec(`ALTER TABLE bookings ALTER COLUMN id SET DEFAULT gen_random_uuid();
 ALTER TABLE bookings ADD COLUMN city text,ADD COLUMN region text,ADD COLUMN act_record_id text UNIQUE,ADD COLUMN venue_name text,ADD COLUMN address_1 text,ADD COLUMN postal_code text,ADD COLUMN probability text;
 CREATE TABLE act_source_records(id uuid PRIMARY KEY,source_database_key text,stream_type text,act_record_id text);
 CREATE TABLE act_source_record_versions(id uuid PRIMARY KEY,source_record_id uuid,raw_snapshot jsonb,fingerprint text);
 CREATE TABLE act_external_links(entity_type text,entity_id uuid,source_record_id uuid,source_database_key text,source_entity_type text,act_record_id text);
 CREATE TABLE act_replacement_apply_batches(id uuid PRIMARY KEY,attempt_token uuid,state text,lease_expires_at timestamptz,updated_at timestamptz);
 INSERT INTO act_source_records VALUES('${source}','fixture-act','opportunity','ACT-EXACT-EVENT');
 INSERT INTO act_replacement_apply_batches VALUES('${batch}','${batch}','applying',now()+interval '1 hour',now());`);
 await pg.query("INSERT INTO act_source_record_versions VALUES($1,$2,$3::jsonb,'original')",[version,source,JSON.stringify(raw)]);
 const imported=await new DrizzleApplyRepository(db as never).createTarget("booking",{name:"Exact signed fair",city:"Denver",region:"CO",localStatus:"contract_received",localProbability:"definite",notes:"Signed history remains",salesMilestones:raw},source,version,{batchId:batch,attemptToken:batch});
 const bookingId=imported.target.id;
 await pg.query("UPDATE bookings SET organization_id=$2,travel_leg_id=$3 WHERE id=$1",[bookingId,orgId,ids.leg]);
 await pg.query("UPDATE activities SET booking_id=$1 WHERE id=$2",[bookingId,noteId]);
 await pg.query("INSERT INTO booking_package_selections VALUES($1,$2)",[bookingId,ids.package]);
 const service=new BookingDateRepairService(db as never);
 const queue=await service.queue({bookingId});
 expect(queue.records[0].dateProvenance.publicWindow).toBeNull();
 expect(queue.records[0].dateProvenance.endpointEvidence.map((e:any)=>e.kind)).toEqual(["sales_milestone","sales_milestone"]);
 const before=await loadPlanFacts(db,[bookingId],actors.owner,new Date());
 expect(before[0].booking.window).toBeNull();expect(before[0].sourceReasons.length).toBeGreaterThan(0);
 const p=await service.preview({...proposal(),bookingId} as never,"owner");
 expect(p.impacts.blocked).toBe(false);
 const receipt=await service.apply({previewId:p.id,fingerprint:p.fingerprint,requestKey:"signed-event"},"owner");
 expect(receipt.bookingId).toBe(bookingId);
 const after=await loadPlanFacts(db,[bookingId],actors.owner,new Date());
 expect(after[0].booking.window?.startsAt).toBe("2027-07-21T06:00:00.000Z");
 expect(after[0].sourceReasons.some(r=>/committed.*window|source.*review/i.test(r))).toBe(false);
 const matches=await pg.query<{id:string}>(`SELECT b.id FROM bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id
 WHERE (booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at)->'publicWindow'->>'start')::timestamptz<='2027-07-26T23:59:59Z'
 AND (booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at)->'publicWindow'->>'end')::timestamptz>='2027-07-21T00:00:00Z'`);
 expect(matches.rows).toEqual([{id:bookingId}]);
 expect((await pg.query("SELECT status,notes FROM bookings WHERE id=$1",[bookingId])).rows[0]).toEqual({status:"contract_received",notes:"Signed history remains"});
 expect((await pg.query("SELECT package_template_id FROM booking_package_selections WHERE booking_id=$1",[bookingId])).rows).toEqual([{package_template_id:ids.package}]);
 expect((await pg.query("SELECT raw_snapshot FROM act_source_record_versions WHERE id=$1",[version])).rows[0]).toEqual({raw_snapshot:raw});
 // A proved signed window remains an obligation even without item-level assignments.
 const classification=proposal().endpoints.map(e=>({...e,kind:"unknown_import",value:null}));
 const clear=await service.preview({bookingId,reason:"Explicit whole public clear proposal",endpoints:classification,clearFields:["public_start","public_end"]} as never,"owner");
 expect(clear.impacts.blocked).toBe(true);
 }finally{await pg.close();}
},30000);
