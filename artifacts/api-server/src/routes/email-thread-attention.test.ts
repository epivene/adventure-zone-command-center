import express from "express";
import request from "supertest";
import { it,expect } from "vitest";
import { createEmailThreadAttentionRouter } from "./email-thread-attention";
import { issueToken } from "../lib/auth";
it("requires owner authentication and rejects malformed decisions before service invocation",async()=>{
 process.env.SESSION_SECRET="email-attention-test-secret";
 const app=express();app.use(express.json());app.use("/attention",createEmailThreadAttentionRouter({} as any));
 expect((await request(app).post("/attention/preview").send({})).status).toBe(401);
 const token=issueToken()!.token;
 expect((await request(app).post("/attention/apply").auth(token,{type:"bearer"}).send({send:true})).status).toBe(400);
});
