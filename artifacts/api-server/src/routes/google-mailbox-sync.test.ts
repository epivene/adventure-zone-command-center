import express from 'express';
import request from 'supertest';
import {expect,it} from 'vitest';
import {issueToken} from '../lib/auth';
import {createMailboxSyncRouter} from './google-mailbox-sync';
it('requires owner authentication and rejects send/unknown fields before resolving dependencies',async()=>{
 process.env.SESSION_SECRET='mailbox-sync-test-secret';let invoked=0;
 const app=express();app.use(express.json());app.use('/sync',createMailboxSyncRouter(async()=>{invoked++;throw Error('unexpected');}));
 expect((await request(app).get('/sync/status')).status).toBe(401);
 const token=issueToken()!.token;
 expect((await request(app).post('/sync/check').auth(token,{type:'bearer'}).send({send:true})).status).toBe(400);
 expect((await request(app).get('/sync/threads?limit=4000').auth(token,{type:'bearer'})).status).toBe(400);
 expect(invoked).toBe(0);
});
it('returns accepted queued checks without fetching Gmail',async()=>{
 process.env.SESSION_SECRET='mailbox-sync-test-secret';const app=express();app.use(express.json());
 app.use('/sync',createMailboxSyncRouter(async()=>({connectionId:'c',read:{} as any,check:async()=>({pending:20}),configure:async()=>({})})));
 const res=await request(app).post('/sync/check').auth(issueToken()!.token,{type:'bearer'}).send({});expect(res.status).toBe(202);expect(res.body.pending).toBe(20);
});
