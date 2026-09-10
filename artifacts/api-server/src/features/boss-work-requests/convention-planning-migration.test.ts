import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const migration=new URL("../../../../../lib/db/migrations/20260910_convention_planning_questionnaire.sql",import.meta.url);
const sql=existsSync(migration)?readFileSync(migration,"utf8"):"SELECT 1";
describe("questionnaire workspace seed",()=>{
  it("places exactly one questionnaire on Dave's list and retains saved answers on rerun",async()=>{
    const db=new PGlite();
    try {
      await db.exec(`CREATE TABLE boss_accounts(id uuid PRIMARY KEY,display_name text,enabled boolean);
        CREATE TABLE communication_templates(id uuid PRIMARY KEY);
        CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY); CREATE TABLE follow_ups(id uuid PRIMARY KEY);`);
      await db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20260909b_boss_work_requests.sql",import.meta.url),"utf8"));
      await db.exec("INSERT INTO boss_accounts VALUES ('11111111-1111-4111-8111-111111111111','Dave',true),('22222222-2222-4222-8222-222222222222','Other boss',true)");
      await db.exec(sql);
      const rows=(await db.query("SELECT * FROM boss_work_requests")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("convention_planning_questionnaire");
      expect(rows[0].assigned_boss_account_id).toBe("11111111-1111-4111-8111-111111111111");
      await db.query("INSERT INTO boss_convention_drafts(request_id,boss_account_id,client_revision,payload) VALUES ($1,$2,4,$3)",[rows[0].id,rows[0].assigned_boss_account_id,JSON.stringify({eventName:"Convention Planning Decisions",planningAnswers:{rmafAttendees:"Dave"}})]);
      await db.exec(sql);
      expect((await db.query("SELECT * FROM boss_work_requests")).rows).toHaveLength(1);
      expect((await db.query("SELECT * FROM boss_work_request_events")).rows).toHaveLength(1);
      expect((await db.query("SELECT payload FROM boss_convention_drafts")).rows[0].payload).toEqual({eventName:"Convention Planning Decisions",planningAnswers:{rmafAttendees:"Dave"}});
    } finally {await db.close();}
  });
});
