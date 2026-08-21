import { useCallback, useEffect, useState } from "react";
import { officeGet } from "@/lib/office-auth-context";
import { OfficeTaskCard, type OfficeTask } from "@/components/office/office-task-card";

export default function OfficeTasksPage(){
  const [view,setView]=useState<"active"|"done">("active");const [tasks,setTasks]=useState<OfficeTask[]>([]);const [error,setError]=useState("");
  const load=useCallback(()=>officeGet<{tasks:OfficeTask[]}>(`/office/tasks?view=${view}`).then((d)=>{setTasks(d.tasks);setError("")}).catch((e)=>setError(e instanceof Error?e.message:"Could not load tasks.")),[view]);
  useEffect(()=>{void load()},[load]);
  return <div className="grid gap-5"><header><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Booking Workspace</p><h1 className="text-3xl font-bold">Tasks</h1><p className="mt-1 text-slate-600">Office work, notes, and completed items.</p></header>
    <div className="flex gap-2"><button className={view==="active"?"button-primary":"button-secondary"} onClick={()=>setView("active")} type="button">Active</button><button className={view==="done"?"button-primary":"button-secondary"} onClick={()=>setView("done")} type="button">Done</button></div>
    {error?<p className="rounded-xl bg-rose-50 p-4 text-rose-700" role="alert">{error}</p>:null}
    <div className="grid gap-3">{tasks.length?tasks.map((task)=><OfficeTaskCard key={task.id} task={task} onChanged={load}/>):<p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">No {view} tasks.</p>}</div>
  </div>;
}
