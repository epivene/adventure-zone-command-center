import { createHash, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import type { IncomingAvailabilityRepository } from "./incoming-availability-repository";
import { INCOMING_LEASE_MS, type LeaseResult, type ResolvedLease } from "./incoming-availability-types";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export class IncomingAvailabilityService {
 constructor(private repository:IncomingAvailabilityRepository, private clock=()=>new Date(), private random=()=>randomBytes(32).toString("base64url")) {}
 private async make(ownerId:string,browserSessionId:string,takeover:boolean):Promise<LeaseResult> { const now=this.clock(); const result={leaseId:randomUUID(),clientIdentity:`inbound_${this.random()}`,leaseSecret:this.random(),expiresAt:new Date(now.getTime()+INCOMING_LEASE_MS)}; if (!await this.repository.acquire({...result,leaseTokenHash:hash(result.leaseSecret),ownerId,browserSessionId},now,takeover)) throw new Error("lease_unavailable"); return result; }
 acquire(input:{ownerId:string;browserSessionId:string}) { return this.make(input.ownerId,input.browserSessionId,false); }
 takeover(input:{ownerId:string;browserSessionId:string}) { return this.make(input.ownerId,input.browserSessionId,true); }
 renew(input:{ownerId:string;leaseId:string;leaseSecret:string}) { const now=this.clock(); return this.repository.renew({...input,leaseTokenHash:hash(input.leaseSecret),now,expiresAt:new Date(now.getTime()+INCOMING_LEASE_MS)}).then(ok=>{if(!ok)throw new Error("stale_lease"); return {...input,clientIdentity:"",expiresAt:new Date(now.getTime()+INCOMING_LEASE_MS)};}); }
 async release(input:{ownerId:string;leaseId:string;leaseSecret:string}) { if (!await this.repository.release({...input,leaseTokenHash:hash(input.leaseSecret)})) throw new Error("stale_lease"); }
 async authorize(input:{ownerId:string;leaseId:string;leaseSecret:string}) { const lease=await this.repository.verify({...input,leaseTokenHash:hash(input.leaseSecret)},this.clock()); if(!lease) throw new Error("stale_lease"); return lease; }
 resolveCurrent(ownerId:string):Promise<ResolvedLease|null>{return this.repository.resolveOwner(ownerId,this.clock());}
 resolveIdentity(clientIdentity:string):Promise<ResolvedLease|null>{return this.repository.resolveIdentity(clientIdentity,this.clock());}
}