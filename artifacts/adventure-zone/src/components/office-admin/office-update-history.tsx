import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";

type HistoryRow={id:string;entityType:string;entityId:string;action:string;after:Record<string,unknown>|null;createdAt:string};
function actionLabel(action:string){return action==="office_profile_updated"?"Profile updated":action==="office_contact_updated"?"Contact updated":action==="office_location_updated"?"Location updated":action==="office_note_created"?"Note added":action.replaceAll("_"," ");}
export function OfficeUpdateHistory(){
  const [history,setHistory]=useState<HistoryRow[]>([]);const [error,setError]=useState("");
  useEffect(()=>{apiGet<{history:HistoryRow[]}>("/office-admin/history").then((data)=>setHistory(data.history)).catch((cause)=>setError(cause instanceof Error?cause.message:"Could not load recent profile updates."));},[]);
  if(error)return null;
  return <section className="mx-auto mt-6 max-w-6xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Office Coordinator</p><h2 className="mt-1 text-xl font-bold">Recent Profile Updates</h2></div><span className="text-xs text-slate-500">Latest 100</span></div>{history.length?<div className="mt-3 grid gap-2">{history.slice(0,20).map((row)=>{const actor=typeof row.after?.officeDisplayName==="string"?row.after.officeDisplayName:"Office Coordinator";const organizationId=typeof row.after?.organizationId==="string"?row.after.organizationId:row.entityType==="organization"?row.entityId:null;return <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"><div><p className="text-sm font-semibold">{actionLabel(row.action)}</p><p className="text-xs text-slate-500">{actor} · {new Date(row.createdAt).toLocaleString()}</p></div>{organizationId?<Link className="text-sm font-semibold text-orange-700" href={`/profiles/${organizationId}`}>Open profile</Link>:null}</div>})}</div>:<p className="mt-3 text-sm text-slate-500">No Office Coordinator profile updates yet.</p>}</section>;
}
