import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeadlineRulesService } from "./service";
import { businessDay, day, deadlineMatch, ruleSchema, type Rule } from "./model";
import { readDeadlines } from "./sources";

let pg:PGlite;
let service:DeadlineRulesService;
const profile="10000000-0000-4000-8000-000000000001";
const booking="20000000-0000-4000-8000-000000000001";
const now=new Date("2026-10-14T16:00:00Z");
const ddl=readFileSync(new URL("../../../../../lib/db/migrations/20261014_deadline_rules.sql",import.meta.url),"utf8");
const beforeRule:Rule={id:"rule",name:"before",enabled:true,created_at:now,trigger:{type:"deadline_before",days:[14,7],useItemOffsets:true},actions:["notify","badge"]};
const item={sourceKey:"x",organizationId:profile,profileName:"Test",kind:"vendor",label:"Vendor",dueOn:"2026-10-28",offsets:null,completed:false,editable:true};

beforeEach(async()=>{
  pg=new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text,application_deadline date,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),consolidated_into_id uuid);
    CREATE TABLE bookings(id uuid PRIMARY KEY,organization_id uuid,name text,starts_at timestamptz,status text,probability text);
    CREATE TABLE contacts(id uuid PRIMARY KEY,organization_id uuid);
    CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,booking_id uuid,contact_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text,updated_at timestamptz DEFAULT now());
    CREATE TABLE invoices(id uuid PRIMARY KEY,organization_id uuid,invoice_number text,status text,balance_due_date date,cancelled_at timestamptz);
    CREATE TABLE event_date_facts(id uuid PRIMARY KEY,organization_id uuid,starts_on date,status text,active boolean);
    CREATE TABLE festival_editions(id uuid PRIMARY KEY,organization_id uuid,year integer,details jsonb);
    CREATE TABLE activities(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,contact_id uuid,kind text,occurred_at timestamptz,created_at timestamptz,deleted_at timestamptz);
    CREATE TABLE call_sessions(id uuid PRIMARY KEY,organization_id uuid,ended_at timestamptz,started_at timestamptz);
  `);
  await pg.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  await pg.exec(ddl);
  await pg.query("INSERT INTO organizations(id,name,created_at) VALUES($1,'Blanding','2026-10-01')",[profile]);
  // PGlite is a single session; transactional locking is exercised by Postgres SQL.
  const db={query:(sql:string,values?:any[])=>pg.query(sql,values),connect:async()=>({query:(sql:string,values?:any[])=>pg.query(sql,values),release(){}})};
  service=new DeadlineRulesService(db as any);
});
afterEach(async()=>{await pg.close();});
describe("deadline dates and rules",()=>{
  it("uses Mountain dates across UTC midnight and DST, rejecting impossible dates",()=>{
    expect(businessDay(new Date("2026-10-15T01:00:00Z"))).toBe("2026-10-14");
    expect(businessDay(new Date("2026-11-01T07:30:00Z"))).toBe("2026-11-01");
    expect(day.safeParse("2026-02-30").success).toBe(false);
    expect(deadlineMatch(beforeRule,item,"2026-10-14")).toBe("14");
    expect(deadlineMatch(beforeRule,item,"2026-10-22")).toBe("7");
    expect(deadlineMatch(beforeRule,{...item,offsets:[]},"2026-10-22")).toBeNull();
    expect(deadlineMatch(beforeRule,{...item,dueOn:null},"2026-10-22")).toBeNull();
    expect(ruleSchema.safeParse({...beforeRule,id:undefined,created_at:undefined}).success).toBe(false);
  });
  it("reapplies the additive migration without resetting disabled defaults",async()=>{
    await pg.query("UPDATE deadline_rules SET enabled=false WHERE seed_key='deadline_before'");
    await pg.exec(ddl);
    const rows=await pg.query("SELECT * FROM deadline_rules");
    expect(rows.rows).toHaveLength(3);
    expect((rows.rows as any[]).find(r=>r.seed_key==="deadline_before").enabled).toBe(false);
  });
  it("deduplicates repeated checks, catches the next threshold, preserves dismissal",async()=>{
    await pg.query("INSERT INTO profile_deadlines(organization_id,kind,label,due_on) VALUES($1,'vendor','Vendor','2026-10-28')",[profile]);
    await service.evaluate(now);
    await service.evaluate(new Date("2026-10-14T17:00:00Z"));
    expect((await pg.query("SELECT * FROM deadline_notifications")).rows).toHaveLength(1);
    await pg.query("UPDATE deadline_notifications SET dismissed_at=now()");
    await service.evaluate(new Date("2026-10-15T16:00:00Z"));
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active AND dismissed_at IS NULL")).rows).toHaveLength(0);
    await pg.query("UPDATE deadline_rules SET enabled=false WHERE seed_key='prospect_inactive'");
    await service.evaluate(new Date("2026-10-21T16:00:00Z"));
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active AND dismissed_at IS NULL")).rows).toHaveLength(1);
  });
  it("expires changed dates and completed occurrences without deleting history",async()=>{
    await pg.query("UPDATE organizations SET application_deadline='2026-10-13' WHERE id=$1",[profile]);
    await service.evaluate(now);
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active")).rows).toHaveLength(1);
    await pg.query("UPDATE organizations SET application_deadline='2026-12-01' WHERE id=$1",[profile]);
    await service.evaluate(new Date("2026-10-14T17:00:00Z"));
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active")).rows).toHaveLength(0);
    expect((await pg.query("SELECT * FROM deadline_notifications")).rows).toHaveLength(1);
    await pg.query("UPDATE organizations SET application_deadline='2026-10-20' WHERE id=$1",[profile]);
    await pg.query("INSERT INTO deadline_preferences(source_key,organization_id,completed_for_date) VALUES($1,$2,'2026-10-20')",["application:"+profile,profile]);
    await service.evaluate(new Date("2026-10-14T18:00:00Z"));
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active")).rows).toHaveLength(0);
  });
  it("reuses invoice and follow-up dates and excludes paid/completed records",async()=>{
    await pg.query("INSERT INTO invoices VALUES(gen_random_uuid(),$1,'INV-1','sent','2026-10-22',NULL),(gen_random_uuid(),$1,'INV-2','paid','2026-10-22',NULL)",[profile]);
    await pg.query("INSERT INTO follow_ups(organization_id,kind,due_at) VALUES($1,'Call','2026-10-20T15:00:00Z')",[profile]);
    const items=await readDeadlines(pg as any,profile);
    expect(items.filter(i=>i.kind==="balance_due")).toHaveLength(1);
    expect(items.find(i=>i.kind==="next_action")?.dueOn).toBe("2026-10-20");
  });
  it("does not treat unverified booking/access dates as public event deadlines",async()=>{
    await pg.query("INSERT INTO bookings VALUES($1,$2,'Festival','2026-10-20','confirmed','definite')",[booking,profile]);
    expect((await readDeadlines(pg as any)).find(i=>i.sourceKey==="booking:"+booking)?.dueOn).toBeNull();
    await pg.query("INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) VALUES($1,'public_start','verified_event','2026-10-20','inclusive_date',1,'owner','test','1','owner')",[booking]);
    expect((await readDeadlines(pg as any)).find(i=>i.sourceKey==="booking:"+booking)?.dueOn).toBe("2026-10-20");
  });
  it("nudges inactive prospects once and clears on real activity",async()=>{
    await pg.query("UPDATE organizations SET created_at='2026-09-01' WHERE id=$1",[profile]);
    await service.evaluate(now);
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active")).rows).toHaveLength(1);
    await pg.query("INSERT INTO activities(id,organization_id,kind,occurred_at,created_at) VALUES(gen_random_uuid(),$1,'note','2026-10-14','2026-10-14')",[profile]);
    await service.evaluate(new Date("2026-10-14T17:00:00Z"));
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active")).rows).toHaveLength(0);
  });
  it("captures real status transitions without firing on initial state",async()=>{
    await pg.query("INSERT INTO deadline_rules(name,trigger,actions,created_at,updated_at) VALUES('Status',$1,$2,'2026-10-01','2026-10-01')",[JSON.stringify({type:"status_changed",status:"interested"}),JSON.stringify(["notify"])]);
    await pg.query("INSERT INTO bookings VALUES($1,$2,'Prospect',NULL,'new_lead','possible')",[booking,profile]);
    expect((await pg.query("SELECT * FROM deadline_status_events")).rows).toHaveLength(0);
    await pg.query("UPDATE bookings SET status='interested' WHERE id=$1",[booking]);
    await pg.query("UPDATE deadline_status_events SET occurred_at='2026-10-14T15:00:00Z'");
    await service.evaluate(now);
    expect((await pg.query("SELECT * FROM deadline_notifications WHERE active")).rows).toHaveLength(1);
  });
  it("creates one owned next action, never replaces a manual one, and never loops",async()=>{
    await pg.query("UPDATE deadline_rules SET actions=$1 WHERE seed_key='deadline_before'",[JSON.stringify(["notify","next_action"])]);
    await pg.query("INSERT INTO profile_deadlines(organization_id,kind,label,due_on) VALUES($1,'vendor','Vendor','2026-10-28')",[profile]);
    await pg.query("INSERT INTO follow_ups(organization_id,kind,due_at) VALUES($1,'Manual','2026-12-01')",[profile]);
    await service.evaluate(now);await service.evaluate(new Date("2026-10-14T17:00:00Z"));
    expect((await pg.query("SELECT * FROM follow_ups")).rows).toHaveLength(2);
    await pg.query("UPDATE deadline_rules SET enabled=false");
    await service.evaluate(new Date("2026-10-14T18:00:00Z"));
    const manual=await pg.query("SELECT * FROM follow_ups WHERE kind='Manual'");
    expect((manual.rows[0] as any).completed_at).toBeNull();
  });
  it("keeps email disabled even when a provider is injected",async()=>{
    let sends=0;
    const db={query:(sql:string,values?:any[])=>pg.query(sql,values),connect:async()=>({query:(sql:string,values?:any[])=>pg.query(sql,values),release(){}})};
    const off=new DeadlineRulesService(db as any,false,{send:async()=>{sends++;}});
    expect(await off.deliverEmail({idempotencyKey:"x",organizationId:profile,title:"test",dueOn:null})).toEqual({state:"disabled"});
    expect(sends).toBe(0);
  });
});
