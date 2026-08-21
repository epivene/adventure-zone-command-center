import { Link } from "wouter";
import { officePatch } from "@/lib/office-auth-context";

export type OfficeTask = { id:string;type:string;title:string;instructions:string|null;profile:{id:string;name:string}|null;contact:{id:string;name:string}|null;status:"todo"|"in_progress"|"waiting"|"done";needsHelp:boolean;coordinatorNote:string|null;dueAt:string|null;completedAt:string|null;updatedAt:string };
const labels={todo:"To do",in_progress:"In progress",waiting:"Waiting",done:"Done"} as const;

export function OfficeTaskCard({task,onChanged}:{task:OfficeTask;onChanged:()=>void}){
  async function patch(body:unknown){await officePatch(`/office/tasks/${task.id}`,body);onChanged();}
  return <article className={`rounded-xl border p-4 shadow-sm ${task.needsHelp?"border-amber-300 bg-amber-50":"border-slate-200 bg-white"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{labels[task.status]}{task.needsHelp?" · Needs Help":""}</p><h3 className="mt-1 font-bold">{task.title}</h3>{task.instructions?<p className="mt-1 text-sm text-slate-600">{task.instructions}</p>:null}</div>{task.dueAt?<span className="text-xs font-semibold text-slate-500">Due {new Date(task.dueAt).toLocaleDateString()}</span>:null}</div>
    {task.profile?<p className="mt-2 text-sm"><Link className="font-semibold text-orange-700 hover:underline" href={`/office/profiles/${task.profile.id}`}>{task.profile.name}</Link>{task.contact?` · ${task.contact.name}`:""}</p>:null}
    <textarea className="mt-3 min-h-20 w-full" aria-label={`Working note for ${task.title}`} defaultValue={task.coordinatorNote??""} placeholder="Working note" onBlur={(e)=>{if(e.target.value.trim()!==(task.coordinatorNote??""))void patch({coordinatorNote:e.target.value})}}/>
    <div className="mt-3 flex flex-wrap gap-2">
      {task.status==="todo"?<button className="button-primary" onClick={()=>void patch({status:"in_progress"})} type="button">Start</button>:null}
      {task.status!=="waiting"&&task.status!=="done"?<button className="button-secondary" onClick={()=>void patch({status:"waiting"})} type="button">Waiting</button>:null}
      {task.status!=="done"?<button className="button-secondary" onClick={()=>void patch({status:"done",needsHelp:false})} type="button">Done</button>:null}
      {task.status==="waiting"?<button className="button-secondary" onClick={()=>void patch({status:"in_progress"})} type="button">Resume</button>:null}
      <button className="button-secondary" onClick={()=>void patch({needsHelp:!task.needsHelp})} type="button">{task.needsHelp?"Help resolved":"Needs Help"}</button>
      {task.type==="mail_brochure"?<Link className="button-secondary" href={`/office/mail?taskId=${task.id}`}>Open Mail</Link>:null}
      {task.type==="draft_email"?<Link className="button-secondary" href={`/office/emails${task.profile?`?profileId=${task.profile.id}`:""}`}>Draft Email</Link>:null}
    </div>
  </article>;
}
