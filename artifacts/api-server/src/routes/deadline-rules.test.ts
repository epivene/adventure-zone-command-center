import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@workspace/db",()=>({pool:{}}));
import { createDeadlineRulesRouter } from "./deadline-rules";
import { issueToken } from "../lib/auth";
afterEach(()=>vi.unstubAllEnvs());
it("keeps every reminder route behind the existing owner authentication",async()=>{
  const query=vi.fn();
  const app=express().use(express.json()).use(createDeadlineRulesRouter({query} as any));
  for(const path of ["/deadline-rules","/deadline-rules/summary","/deadline-rules/profiles/10000000-0000-4000-8000-000000000001"]){
    expect((await request(app).get(path)).status).toBe(401);
  }
  expect((await request(app).post("/deadline-rules/evaluate")).status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});
it("validates rule inputs and preserves the email-disabled default",async()=>{
  vi.stubEnv("SESSION_SECRET","test-only-secret");vi.stubEnv("DEADLINE_EMAIL_ENABLED","false");
  const query=vi.fn().mockResolvedValue({rows:[]});
  const app=express().use(express.json()).use(createDeadlineRulesRouter({query} as any));
  const auth="Bearer "+issueToken()!.token;
  const bad=await request(app).post("/deadline-rules").set("Authorization",auth).send({name:"Bad",enabled:true,trigger:{type:"inactive",days:-1},actions:["email"]});
  expect(bad.status).toBe(400);expect(query).not.toHaveBeenCalled();
  const result=await request(app).get("/deadline-rules").set("Authorization",auth);
  expect(result.body.email).toEqual({enabled:false,providerConfigured:false});
});
