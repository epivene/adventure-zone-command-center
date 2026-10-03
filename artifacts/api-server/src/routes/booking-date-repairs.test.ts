import express from "express";
import request from "supertest";
import { beforeEach,it,expect,vi } from "vitest";
vi.hoisted(()=>{process.env.DATABASE_URL="postgres://test:test@localhost:5432/test";});
import { issueToken,requireOwnerMiddleware } from "@/lib/auth";
import { createBookingDateRepairsRouter } from "./booking-date-repairs";
import { proposal } from "../features/booking-date-repair/date-repair-test-setup";
const path="/event-date-coverage/booking-date-repairs";
beforeEach(()=>{process.env.SESSION_SECRET="date-repair-test-secret";});
const setup=()=>{
 const service={queue:vi.fn(async()=>({records:[],nextCursor:null})),preview:vi.fn(async()=>({id:"preview"})),apply:vi.fn(async()=>({id:"receipt"}))};
 const app=express();app.use(express.json());app.use(createBookingDateRepairsRouter(service as never,requireOwnerMiddleware));
 return {app,service,token:issueToken()!.token};
};
it("requires owner authentication and rejects manager/boss-shaped tokens",async()=>{
 const {app}=setup();
 for(const authorization of ["","Bearer manager.fixture","Bearer boss.fixture"])
  for(const endpoint of ["", "/preview","/apply"]){
   const call=endpoint?request(app).post(path+endpoint).send(proposal()):request(app).get(path);
   expect((await call.set("Authorization",authorization)).status).toBe(401);
  }
});
it("derives a stable actor from the authenticated single-owner session and serves bounded queue",async()=>{
 const {app,service,token}=setup(),auth="Bearer "+token;
 expect((await request(app).get(path+"?limit=25").set("Authorization",auth)).status).toBe(200);
 expect((await request(app).post(path+"/preview").set("Authorization",auth).send(proposal())).status).toBe(201);
 expect(service.preview).toHaveBeenCalledWith(proposal(),"single-owner");
 const apply={previewId:"20000000-0000-4000-8000-000000000001",fingerprint:"expected",requestKey:"stable"};
 expect((await request(app).post(path+"/apply").set("Authorization",auth).send(apply)).status).toBe(200);
 expect(service.apply).toHaveBeenCalledWith(apply,"single-owner");
});
it("rejects malformed, extra actor/revision fields and excessive queue sizes",async()=>{
 const {app,token,service}=setup(),auth="Bearer "+token;
 for(const body of [{...proposal(),actorId:"fabricated"},{...proposal(),bookingId:"not-uuid"},{...proposal(),endpoints:proposal().endpoints.map(e=>({...e,revision:999}))},{...proposal(),endpoints:proposal().endpoints.map(e=>({...e,sourceRef:{...e.sourceRef,revision:"fake"}}))}]){
 expect((await request(app).post(path+"/preview").set("Authorization",auth).send(body)).status).toBe(400);}
 expect((await request(app).get(path+"?limit=999").set("Authorization",auth)).status).toBe(400);
 expect((await request(app).get(path+"?actorId=fake").set("Authorization",auth)).status).toBe(400);
 expect(service.preview).not.toHaveBeenCalled();
});
it("returns stale 409 without disguising it as an internal error",async()=>{
 const {app,token,service}=setup();service.apply.mockRejectedValue(Object.assign(new Error("PREVIEW_STALE"),{status:409,code:"PREVIEW_STALE"}));
 const res=await request(app).post(path+"/apply").set("Authorization","Bearer "+token).send({previewId:"20000000-0000-4000-8000-000000000001",fingerprint:"expected",requestKey:"stable"});
 expect(res.status).toBe(409);expect(res.body.code).toBe("PREVIEW_STALE");
});
