import { apiFetch } from "@/lib/auth-token";
import type { BookingDateProvenance } from "@workspace/api-zod";
export type Endpoint=BookingDateProvenance["endpointEvidence"][number];
export type Source={type:string;id:string;revision:string;label:string;content:string;classifyOnly?:boolean;contentTruncated?:boolean;allowed?:Partial<Record<Endpoint["field"],{value:string;semantics:Endpoint["semantics"]}>>};
export type RepairRecord={bookingId:string;profileId:string|null;name:string;status:string;season:string|null;
 packages:Array<{package_template_id:string;package_name?:string|null}>;assignments:Array<{resource_id:string}>;
 dateProvenance:BookingDateProvenance;sources:Source[]};
export type Proposal={bookingId:string;reason:string;endpoints:Array<Omit<Endpoint,"revision"|"sourceRef">&{sourceRef:{type:string;id:string}}>;clearFields:Endpoint["field"][]};
export type Values={rawPublic:{start:string|null;end:string|null};rawReservation:{start:string|null;end:string|null};evidence:Endpoint[]};
export type Preview={id:string;bookingId:string;fingerprint:string;expiresAt:string;before:Values;after:Values;
 beforeResolved:BookingDateProvenance;afterResolved:BookingDateProvenance;
 impacts:{blocked:boolean;reasons:string[];affectedBookingIds:string[]}};
export type Receipt={id:string;bookingId:string;previewId:string;requestKey:string;appliedAt:string};
export class DateRepairError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function request<T>(path:string,body?:unknown):Promise<T>{
 const response=await apiFetch(path,body===undefined?{}:{method:"POST",body:JSON.stringify(body)});
 if(!response.ok){const value=await response.json().catch(()=>({}));throw new DateRepairError(value.error??"Date review unavailable",response.status);}
 return response.json() as Promise<T>;
}
const path="/event-date-coverage/booking-date-repairs";
export function getDateRepairs(input:{bookingId?:string;after?:string;limit?:number;season?:number;reason?:string}={}){
 const params=new URLSearchParams();for(const [key,value]of Object.entries(input))if(value!==undefined)params.set(key,String(value));
 return request<{records:RepairRecord[];nextCursor:string|null}>(path+"?"+params);
}
export const previewDateRepair=(input:Proposal)=>request<Preview>(path+"/preview",input);
export const applyDateRepair=(input:{previewId:string;fingerprint:string;requestKey:string})=>request<Receipt>(path+"/apply",input);
