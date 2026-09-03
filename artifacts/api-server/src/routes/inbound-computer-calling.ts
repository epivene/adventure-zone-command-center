import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { InboundCallingConfigResult } from "@/features/calls/inbound-calling-config";
import type { InboundVoiceProvider } from "@/features/calls/inbound-voice-provider";
import { IncomingAvailabilityService } from "@/features/calls/incoming-availability-service";
import type { InboundCallService } from "@/features/calls/inbound-call-service";
import type { InboundVoicemailService } from "@/features/calls/inbound-voicemail-service";

const ownerId = "owner";
const browserSchema = z.object({ browserSessionId: z.string().min(16).max(256) }).strict();
const leaseSchema = z.object({ leaseId: z.string().uuid(), leaseSecret: z.string().min(32).max(256) }).strict();
export function createInboundComputerCallingRouter(deps: {
 service: IncomingAvailabilityService;
 getConfig: () => InboundCallingConfigResult;
 isAssistedCallingEnabled: () => boolean;
 providerForConfig: () => InboundVoiceProvider;
 calls?: InboundCallService;
 voicemails?: InboundVoicemailService;
}) {
 const router = Router();
 const enabled = () => deps.isAssistedCallingEnabled() && deps.getConfig().enabled;
 const unavailable = (res: any) => res.status(503).json({ error: "feature_disabled" });
 router.get("/calls/incoming/config", (_req, res) => res.json(enabled() ? deps.getConfig().capability : { enabled:false, reason:"disabled", inboundNumberDisplay:null, retentionDays:30, maxSeconds:120 }));
 router.post("/calls/incoming/availability", async (req,res) => {
  const takeover=Boolean(req.body?.takeover); if(!enabled())return unavailable(res);
  try { const browserSessionId=req.get("X-Browser-Session") ?? randomUUID(); const lease=takeover?await deps.service.takeover({ownerId,browserSessionId}):await deps.service.acquire({ownerId,browserSessionId}); res.status(201).json({...lease,secret:lease.leaseSecret,activeCall:false}); } catch { res.status(409).json({error:"lease_unavailable"}); }
 });
 router.post("/calls/computer/inbound/leases/takeover", async (req,res) => {
  const body=browserSchema.safeParse(req.body); if(!body.success){res.status(400).json({error:"invalid_request"});return;} if(!enabled())return unavailable(res);
  try { res.json(await deps.service.takeover({ownerId,browserSessionId:body.data.browserSessionId})); } catch { res.status(409).json({error:"active_call_or_lease"}); }
 });
 router.patch("/calls/incoming/availability/:leaseId", async (req,res) => {
  const body=z.object({secret:z.string().min(32).max(256)}).strict().safeParse(req.body); if(!body.success||!z.string().uuid().safeParse(req.params.leaseId).success){res.status(400).json({error:"invalid_request"});return;} if(!enabled())return unavailable(res);
  try { const lease=await deps.service.renew({ownerId,leaseId:req.params.leaseId,leaseSecret:body.data.secret}); res.json({...lease,secret:body.data.secret,activeCall:false}); } catch { res.status(409).json({error:"stale_lease"}); }
 });
 router.delete("/calls/incoming/availability/:leaseId", async (req,res) => {
  const body=z.object({secret:z.string().min(32).max(256)}).strict().safeParse(req.body); if(!body.success||!z.string().uuid().safeParse(req.params.leaseId).success){res.status(400).json({error:"invalid_request"});return;} if(!enabled())return unavailable(res);
  try { await deps.service.release({ownerId,leaseId:req.params.leaseId,leaseSecret:body.data.secret}); res.status(204).send(); } catch { res.status(409).json({error:"stale_lease"}); }
 });
 router.post("/calls/incoming/availability/:leaseId/token", async (req,res) => {
  const body=z.object({secret:z.string().min(32).max(256)}).strict().safeParse(req.body); if(!body.success||!z.string().uuid().safeParse(req.params.leaseId).success){res.status(400).json({error:"invalid_request"});return;} if(!enabled())return unavailable(res);
  try {
   const current=await deps.service.authorize({ownerId,leaseId:req.params.leaseId,leaseSecret:body.data.secret});
   const token=await deps.providerForConfig().createBrowserToken({identity:current.clientIdentity,ttlSeconds:300,allowIncoming:true});
   res.set("Cache-Control","no-store").json(token);
  } catch { res.status(409).json({error:"stale_lease"}); }
 });
 router.get("/calls/incoming/sessions/:id", async(req,res)=>{if(!enabled())return unavailable(res); const session=await deps.calls?.get(req.params.id,ownerId); if(!session){res.status(404).json({error:"not_found"});return;}res.json({id:session.id,status:session.status,caller:{displayName:session.caller.callerNumber?"Caller":"Unknown caller",matched:Boolean(session.caller.phoneId),organizationId:session.caller.organizationId,contactId:session.caller.contactId,phoneId:session.caller.phoneId},startedAt:null,answeredAt:session.answeredAt?.toISOString()??null,endedAt:null});});
 router.post("/calls/incoming/sessions/:id/voicemail",async(req,res)=>{
  const config=deps.getConfig();
  if(!deps.isAssistedCallingEnabled()||!config.enabled)return unavailable(res);
  const session=await deps.calls?.voicemail(req.params.id,ownerId);
  if(!session){res.status(409).json({error:"not_available"});return;}
  const provider=deps.providerForConfig();
  const twiml=provider.createVoicemailTwiml({
   maxSeconds:config.config.maxSeconds,
   actionUrl:new URL("/api/webhooks/twilio/voice/inbound/voicemail",config.config.voiceConfig.webhookBaseUrl).toString(),
   recordingStatusCallbackUrl:new URL("/api/webhooks/twilio/voice/inbound/recording",config.config.voiceConfig.webhookBaseUrl).toString(),
  });
  try { await provider.redirectCallToVoicemail({callSid:session.providerParentCallSid,twiml}); }
  catch { res.status(502).json({error:"voicemail_redirect_failed"});return; }
  res.status(204).send();
 });
 router.get("/calls/voicemail",async(req,res)=>{ if(!enabled())return unavailable(res); const cursor=typeof req.query.cursor==="string"&&z.string().uuid().safeParse(req.query.cursor).success?req.query.cursor:undefined; res.json(await deps.voicemails?.list(ownerId,cursor) ?? {items:[],nextCursor:null,newCount:0,handledCount:0}); });
 router.post("/calls/voicemail/:id/handled",async(req,res)=>{if(!enabled())return unavailable(res); if(!z.string().uuid().safeParse(req.params.id).success){res.status(400).json({error:"invalid_request"});return;} if(!await deps.voicemails?.markHandled(ownerId,req.params.id)){res.status(404).json({error:"not_found"});return;}res.status(204).send();});
 router.patch("/calls/voicemail/:id/link",async(req,res)=>{const body=z.object({organizationId:z.string().uuid(),contactId:z.string().uuid(),phoneId:z.string().uuid()}).strict().safeParse(req.body);if(!enabled())return unavailable(res);if(!body.success||!z.string().uuid().safeParse(req.params.id).success){res.status(400).json({error:"invalid_request"});return;}if(!await deps.voicemails?.link(ownerId,req.params.id,body.data)){res.status(404).json({error:"not_found"});return;}res.status(204).send();});
 router.delete("/calls/voicemail/:id/audio",async(req,res)=>{if(!enabled())return unavailable(res);if(!z.string().uuid().safeParse(req.params.id).success){res.status(400).json({error:"invalid_request"});return;}if(!await deps.voicemails?.deleteAudio(ownerId,req.params.id)){res.status(409).json({error:"not_available"});return;}res.status(204).send();});
 router.get("/calls/voicemail/:id/audio",async(req,res)=>{if(!enabled())return unavailable(res);const media=await deps.voicemails?.media(ownerId,req.params.id);if(!media){res.status(404).json({error:"not_found"});return;}res.set({"Content-Type":"audio/mpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});media.body.pipe(res);});
 return router;
}
