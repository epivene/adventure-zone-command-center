import { useRef, useState } from "react";
import { saveConventionDraft, submitConventionNotes } from "../../features/boss-work-requests/boss-work-request-api";
import type { BossWorkRequestDetail, ConventionNotes } from "../../features/boss-work-requests/boss-work-request-types";
import { planningSections } from "../../features/boss-work-requests/convention-planning-questionnaire";

function PlanningFields({answers,onChange,disabled=false}:{answers:Record<string,string>;onChange?:(key:string,value:string)=>void;disabled?:boolean}) {
  return <div className="grid gap-5">{planningSections.map(section=><section key={section.title} className="rounded-xl border bg-card p-4 sm:p-6">
    <h2 className="text-lg font-bold">{section.title}</h2>
    {section.date && <p className="mt-1 font-semibold">{section.date}</p>}
    {section.paragraphs.map(text=><p key={text} className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>)}
    <div className="mt-4 grid gap-4">{section.fields.map(field=>onChange ? <label key={field.key} className="grid gap-1 text-sm font-semibold">{field.label}
      {field.choices ? <select disabled={disabled} className="min-h-12 w-full rounded-lg border bg-background p-3 text-base" value={answers[field.key]??""} onChange={event=>onChange(field.key,event.target.value)}><option value="">Choose…</option>{field.choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}</select>
      : field.kind==="long" ? <textarea disabled={disabled} rows={4} className="rounded-lg border bg-background p-3 text-base" value={answers[field.key]??""} onChange={event=>onChange(field.key,event.target.value)} />
      : <input disabled={disabled} type={field.kind==="date"?"date":"text"} className="min-h-12 min-w-0 rounded-lg border bg-background p-3 text-base" value={answers[field.key]??""} onChange={event=>onChange(field.key,event.target.value)} />}
    </label> : <div key={field.key}><p className="text-sm font-semibold">{field.label}</p><p className="whitespace-pre-wrap break-words">{answers[field.key]||"Not answered"}</p></div>)}</div>
  </section>)}</div>;
}

export function ConventionPlanningAnswers({answers}:{answers:Record<string,string>}) {
  return <PlanningFields answers={answers} />;
}

export function ConventionPlanningForm({detail,reload}:{detail:BossWorkRequestDetail;reload:()=>Promise<void>}) {
  const latest=detail.submissions[0];
  const clarification=detail.request.state==="returned_for_clarification" ? [...(detail.events??[])].reverse().find(event=>event.actorKind==="owner"&&event.newState==="returned_for_clarification")?.note : null;
  const closed=["submitted_to_owner","approved","applied","cancelled"].includes(detail.request.state);
  const initial=closed ? latest?.payload : detail.draft && (!latest || new Date(detail.draft.updatedAt)>new Date(latest.updatedAt)) ? detail.draft.payload : latest?.payload;
  const [payload,setPayload]=useState<ConventionNotes>(initial??{eventName:"Convention Planning Decisions",planningAnswers:{}});
  const revision=useRef(detail.draft?.clientRevision??0);
  const mutation=useRef(crypto.randomUUID());
  const [working,setWorking]=useState(false);
  const [submitted,setSubmitted]=useState(closed);
  const [conflict,setConflict]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");

  async function save(submit:boolean) {
    if(working||submitted||conflict)return;
    setWorking(true);setError("");setStatus("");
    try {
      if(submit) {
        if(!Object.values(payload.planningAnswers??{}).some(value=>value.trim()))throw new Error("Add an answer before submitting.");
        await submitConventionNotes(detail.request.id,mutation.current,payload);
        setSubmitted(true);setStatus("Answers submitted to Desiree.");
        await reload();
      } else {
        const result=await saveConventionDraft(detail.request.id,revision.current+1,payload);
        if(!result.accepted){setConflict(true);throw new Error("This form was saved on another device. Keep a copy of your changes, then reopen it to load the latest answers.");}
        revision.current=result.draft.clientRevision;setStatus("Progress saved. You can leave and return later.");
      }
    } catch(cause) {setError(cause instanceof Error?cause.message:"Could not save. Your answers are still on this page.");}
    finally {setWorking(false);}
  }

  return <div className="mx-auto grid w-full max-w-3xl gap-4">
    {clarification && <div className="rounded-xl border p-4"><h2 className="font-bold">Note from Desiree</h2><p className="whitespace-pre-wrap">{clarification}</p></div>}
    <p>Please fill in the blanks and mark the choices you want so I can finish the convention registrations, advertising, and hotel planning.</p>
    {submitted ? <><p role="status">{detail.request.state==="cancelled"?"This questionnaire is closed.":"Submitted answers"}</p><ConventionPlanningAnswers answers={payload.planningAnswers??{}} /></>
    : <><p className="text-sm text-muted-foreground">Use Save progress before leaving. Submit answers when you’re ready for Desiree to review them.</p><PlanningFields answers={payload.planningAnswers??{}} disabled={working||conflict} onChange={(key,value)=>{mutation.current=crypto.randomUUID();setStatus("");setPayload(current=>({...current,planningAnswers:{...current.planningAnswers,[key]:value}}));}} />
      <div className="flex flex-wrap gap-3"><button type="button" disabled={working||conflict} onClick={()=>void save(false)} className="min-h-12 rounded-xl border px-5 font-bold disabled:opacity-60">{working?"Saving…":"Save progress"}</button><button type="button" disabled={working||conflict} onClick={()=>void save(true)} className="min-h-12 rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:opacity-60">Submit answers</button></div></>}
    {status&&<p role="status" className="text-sm font-semibold">{status}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
