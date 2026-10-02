import { resolveBookingDates } from "./date-evidence";
export class BookingDateRepairService {
 constructor(readonly database:any){}
 async preview(proposal:any,actorId:string):Promise<any>{return {id:"00000000-0000-4000-8000-000000000999",actorId,bookingId:proposal.bookingId,expiresAt:new Date(Date.now()+1800000).toISOString(),fingerprint:"scaffold",before:{},after:{rawPublic:{start:null}},impacts:{blocked:false,reasons:[],affectedBookingIds:[]}};}
 async apply(_input:any,_actorId:string):Promise<any>{throw new Error("Date repair not implemented");}
}
