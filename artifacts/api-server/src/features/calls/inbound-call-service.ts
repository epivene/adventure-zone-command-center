import type { InboundCallerMatch, InboundCallerMatcher } from "./inbound-caller-matcher";
export type InboundSession = { id:string; ownerId:string; providerParentCallSid:string; status:string; answeredAt:Date|null; caller:InboundCallerMatch };
export interface InboundCallRepository {
 begin(input:{ownerId:string;providerParentCallSid:string;ingressNumber:string;caller:InboundCallerMatch;now:Date}):Promise<InboundSession>;
 setDialResult(input:{parentSid:string;status:string;now:Date}):Promise<InboundSession|null>;
 find(input:{id:string;ownerId:string}):Promise<InboundSession|null>;
 requestVoicemail(input:{id:string;ownerId:string;now:Date}):Promise<boolean>;
}
export class InboundCallService {
 constructor(private repository:InboundCallRepository, private matcher:InboundCallerMatcher, private clock=()=>new Date()) {}
 async begin(input:{ownerId:string;parentSid:string;ingressNumber:string;from?:string}) { return this.repository.begin({ownerId:input.ownerId,providerParentCallSid:input.parentSid,ingressNumber:input.ingressNumber,caller:await this.matcher.match(input.from),now:this.clock()}); }
 dialResult(parentSid:string,status:string) { return this.repository.setDialResult({parentSid,status,now:this.clock()}); }
 get(id:string,ownerId:string) { return this.repository.find({id,ownerId}); }
 voicemail(id:string,ownerId:string) { return this.repository.requestVoicemail({id,ownerId,now:this.clock()}); }
}