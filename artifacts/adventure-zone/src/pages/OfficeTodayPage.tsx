import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { officeGet } from "@/lib/office-auth-context";
import { OfficeTaskCard, type OfficeTask } from "@/components/office/office-task-card";

type ReturnedDraft={id:string;organizationId:string;recipientEmail:string;subject:string;ownerReturnNote:string|null;state:string};
type TodayData={tasks:OfficeTask[];activeCount:number;needsHelpCount:number;needsChanges:ReturnedDraft[];unreadMessages:number};

export default function OfficeTodayPage(){
  const [data,setData]=useState<TodayData|null>(null);const [error,setError]=useState("");
  const load=useCallback(()=>officeGet<TodayData>("/office/today").then(setData).catch((e)=>setError(e instanceof Error?e.message:"Could not load Today.")),[]);
  useEffect(()=>{void load()},[load]);
  if(!data&&!error)return <p className="text-slate-500">Loading Today…</p>;
  if(error)return <p className="rounded-xl bg-rose-50 p-4 text-rose-700" role="alert">{error}</p>;
  return <div className="grid gap-6">
    <header><div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-3xl font-bold">Today</h1><p className="text-sm font-semibold text-slate-600">{data!.activeCount} active · {data!.needsHelpCount} needs help</p></div></header>
    {data!.needsChanges.length?<section className="grid gap-3"><h2 className="text-xl font-bold">Emails to update</h2>{data!.needsChanges.map((draft)=><Link key={draft.id} href={`/office/emails?draftId=${draft.id}`} className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Needs Changes</p><p className="mt-1 font-bold">{draft.subject}</p><p className="text-sm text-slate-600">To {draft.recipientEmail}</p>{draft.ownerReturnNote?<p className="mt-2 text-sm text-amber-900">{draft.ownerReturnNote}</p>:null}</Link>)}</section>:null}
    <section className="grid gap-3"><div className="flex items-center justify-between"><h2 className="text-2xl font-bold">Next up</h2><Link className="text-sm font-semibold text-orange-700" href="/office/tasks">All tasks</Link></div>{data!.tasks.length?data!.tasks.map((task)=><OfficeTaskCard key={task.id} task={task} onChanged={load}/>):<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold">Nothing is waiting right now.</p></div>}</section>
    {data!.unreadMessages?<Link href="/office/messages" className="rounded-xl border border-orange-200 bg-orange-50 p-4 font-semibold text-orange-900">{data!.unreadMessages} unread message{data!.unreadMessages===1?"":"s"}</Link>:null}
  </div>;
}
