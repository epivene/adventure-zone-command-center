import { useEffect, useState } from "react";
import { apiFetch, apiGet } from "@/lib/auth-token";
import { RehireStatus } from "@/components/manager/rehire-status";

const actionButton = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold shadow-sm";
const deleteButton = "rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 shadow-sm";

export default function ManagerCrewAdminPage(){
  const[workers,setWorkers]=useState<any[]>([]);
  const[query,setQuery]=useState("");
  const[status,setStatus]=useState("all");
  const[confirming,setConfirming]=useState<string|null>(null);
  const[error,setError]=useState("");
  useEffect(()=>{apiGet<any>("/manager-admin/crew").then(d=>setWorkers(d.workers??[]))},[]);
  const filtered=workers.filter(w=>(status==="all"||w.rehireStatus===status)&&(!query||`${w.name} ${w.city??""} ${w.region??""}`.toLowerCase().includes(query.toLowerCase())));
  async function deleteWorker(worker:any){
    setError("");
    const response=await apiFetch(`/manager-admin/crew/${worker.id}`,{method:"DELETE"});
    if(!response.ok){setError("Could not delete worker");return;}
    setWorkers(current=>current.filter(entry=>entry.id!==worker.id));
    setConfirming(null);
  }
  return <div className="mx-auto grid max-w-5xl gap-4"><h1 className="text-3xl font-bold">Seasonal crew</h1><div className="grid grid-cols-2 gap-2"><input aria-label="Search crew admin" placeholder="Search name or location" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Rehire filter" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All rehire statuses</option><option value="rehirable">Rehirable</option><option value="undecided">Undecided</option><option value="do_not_rehire">Do Not Rehire</option></select></div>{error?<p role="alert" className="text-sm font-semibold text-red-700">{error}</p>:null}{filtered.map(w=><article key={w.id} className="rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><div><b>{w.name}</b><p>{w.locationText||[w.city,w.region].filter(Boolean).join(", ")}</p><p className="text-sm text-slate-600">{w.workHistory?.length??0} work history entries</p></div><RehireStatus status={w.rehireStatus}/></div>{confirming===w.id?<div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"><p className="text-sm text-red-900">Permanently delete <b>{w.name}</b>? Their work history, ratings, and manager notes will also be deleted.</p><div className="mt-2 flex gap-2"><button className={deleteButton} onClick={()=>void deleteWorker(w)}>{`Delete ${w.name}`}</button><button className={actionButton} onClick={()=>setConfirming(null)}>Cancel</button></div></div>:<button className={`${deleteButton} mt-3`} onClick={()=>setConfirming(w.id)}>Delete worker</button>}</article>)}</div>}
