import { Router, type Request } from "express";
import { z } from "zod";
import type { InboundCallingConfigResult } from "@/features/calls/inbound-calling-config";
import type { InboundVoiceProvider } from "@/features/calls/inbound-voice-provider";
import type { IncomingAvailabilityService } from "@/features/calls/incoming-availability-service";
import type { InboundCallService } from "@/features/calls/inbound-call-service";
import type { InboundVoicemailService } from "@/features/calls/inbound-voicemail-service";
const form=z.record(z.string(),z.string());
const inbound=z.object({CallSid:z.string().regex(/^CA[A-Za-z0-9]{8,}$/),To:z.string(),From:z.string().optional()}).passthrough();
const dial=z.object({CallSid:z.string(),To:z.string(),DialCallStatus:z.string().max(64),DialCallSid:z.string().optional()}).passthrough();
const status=z.object({CallSid:z.string().regex(/^CA[A-Za-z0-9]{8,}$/),CallStatus:z.string().min(1).max(64),ParentCallSid:z.string().optional()}).passthrough();
const voicemail=z.object({CallSid:z.string().regex(/^CA[A-Za-z0-9]{8,}$/),To:z.string()}).passthrough();
function xml(res:any,value:string){res.type("text/xml").send(value);}
export function createTwilioInboundVoiceWebhooksRouter(deps:{
 getInboundConfig:()=>InboundCallingConfigResult; isAssistedCallingEnabled:()=>boolean;
 providerForConfig:(config:Extract<InboundCallingConfigResult,{enabled:true}>["config"]["voiceConfig"])=>InboundVoiceProvider;
 availability:IncomingAvailabilityService; calls:InboundCallService;
 voicemails: InboundVoicemailService;
}) {
 const router=Router();
 const config=()=>{
  if(!deps.isAssistedCallingEnabled()) return null;
  const inboundConfig=deps.getInboundConfig();
  return inboundConfig.enabled
    ? { inbound: inboundConfig.config, computer: inboundConfig.config.voiceConfig }
    : null;
 };
 const signed=(req:Request,p:InboundVoiceProvider,data:Record<string,string>,c:any)=>{const signature=req.get("X-Twilio-Signature");return !!signature&&p.validateWebhook({signature,url:new URL(req.originalUrl,c.webhookBaseUrl).toString(),params:data});};
 router.post("/webhooks/twilio/voice/inbound",async(req,res)=>{
  const data=form.safeParse(req.body);const c=config(); if(!data.success||!c){xml(res,"<Response><Say>We cannot answer right now. Please try again later.</Say><Hangup/></Response>");return;}
  const provider=deps.providerForConfig(c.computer);if(!signed(req,provider,data.data,c.computer)){res.status(403).send();return;}
  const fields=inbound.safeParse(data.data);if(!fields.success||fields.data.To!==c.inbound.inboundNumber){res.status(400).send();return;}
  try { const lease=await deps.availability.resolveCurrent("owner"); const session=await deps.calls.begin({ownerId:lease?.ownerId??"owner",parentSid:fields.data.CallSid,ingressNumber:c.inbound.inboundNumber,from:fields.data.From});
   if(!lease) {xml(res,provider.createVoicemailTwiml({maxSeconds:c.inbound.maxSeconds,actionUrl:new URL("/api/webhooks/twilio/voice/inbound/voicemail",c.computer.webhookBaseUrl).toString(),recordingStatusCallbackUrl:new URL("/api/webhooks/twilio/voice/inbound/recording",c.computer.webhookBaseUrl).toString()}));return;}
   xml(res,provider.createClientDialTwiml({identity:lease.clientIdentity,sessionId:session.id,actionUrl:new URL(`/api/webhooks/twilio/voice/inbound/dial-result?sessionId=${session.id}`,c.computer.webhookBaseUrl).toString(),statusCallbackUrl:new URL("/api/webhooks/twilio/voice/inbound/status",c.computer.webhookBaseUrl).toString()}));
  } catch { xml(res,provider.createUnavailableTwiml()); }
 });
 router.post("/webhooks/twilio/voice/inbound/dial-result",async(req,res)=>{
  const data=form.safeParse(req.body);const c=config();if(!data.success||!c){res.status(403).send();return;}const p=deps.providerForConfig(c.computer);if(!signed(req,p,data.data,c.computer)){res.status(403).send();return;}const f=dial.safeParse(data.data);if(!f.success||f.data.To!==c.inbound.inboundNumber){res.status(400).send();return;}
  const session=await deps.calls.dialResult(f.data.CallSid,f.data.DialCallStatus); if(session?.answeredAt||f.data.DialCallStatus==="completed"){xml(res,"<Response><Hangup/></Response>");return;}
  xml(res,p.createVoicemailTwiml({maxSeconds:c.inbound.maxSeconds,actionUrl:new URL("/api/webhooks/twilio/voice/inbound/voicemail",c.computer.webhookBaseUrl).toString(),recordingStatusCallbackUrl:new URL("/api/webhooks/twilio/voice/inbound/recording",c.computer.webhookBaseUrl).toString()}));
 });
 router.post("/webhooks/twilio/voice/inbound/status",async(req,res)=>{
  const data=form.safeParse(req.body);const c=config();if(!data.success||!c){res.status(403).send();return;}const p=deps.providerForConfig(c.computer);if(!signed(req,p,data.data,c.computer)){res.status(403).send();return;}
  if(!status.safeParse(data.data).success){res.status(400).send();return;}res.status(204).send();
 });
 router.post("/webhooks/twilio/voice/inbound/voicemail",async(req,res)=>{
  const data=form.safeParse(req.body);const c=config();if(!data.success||!c){res.status(403).send();return;}const p=deps.providerForConfig(c.computer);if(!signed(req,p,data.data,c.computer)){res.status(403).send();return;}
  const fields=voicemail.safeParse(data.data);if(!fields.success||fields.data.To!==c.inbound.inboundNumber){res.status(400).send();return;}xml(res,"<Response><Hangup/></Response>");
 });
 router.post("/webhooks/twilio/voice/inbound/recording",async(req,res)=>{
  const data=form.safeParse(req.body); const c=config(); if(!data.success||!c){res.status(403).send();return;} const p=deps.providerForConfig(c.computer); if(!signed(req,p,data.data,c.computer)){res.status(403).send();return;}
  const fields=z.object({CallSid:z.string().regex(/^CA[A-Za-z0-9]{8,}$/),To:z.string(),RecordingSid:z.string().regex(/^RE[A-Za-z0-9]{8,}$/),RecordingDuration:z.string().regex(/^\d+$/).optional()}).safeParse(data.data);
  if(!fields.success||fields.data.To!==c.inbound.inboundNumber){res.status(400).send();return;}
  await deps.voicemails.record({parentSid:fields.data.CallSid,recordingSid:fields.data.RecordingSid,duration:fields.data.RecordingDuration?Number(fields.data.RecordingDuration):undefined,retentionDays:c.inbound.retentionDays}); res.status(204).send();
 });
 return router;
}
