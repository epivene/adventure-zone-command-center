import { useState } from "react";
import { Link } from "wouter";

export type ReviewGroup = "owner"|"drafts"|"calls"|"first_followup"|"waiting"|"verification"|"outdated";
export type AttentionNotice = { id:string; organizationId:string; profileName:string; title:string; dueOn:string|null; triggerType?:string; deadlineKind?:string|null; attentionState?:"waiting_reply"|null; attentionReview?:{group:ReviewGroup;nextAction:string;reviewedOn:string}|null };
const actionSections = [
  {key:"owner",title:"Owner, payment and operations",description:"Decisions, payment checks and booked-event work to review first."},
  {key:"drafts",title:"Existing drafts to review",description:"Review the saved drafts and current terms. Nothing is sent from this view."},
  {key:"verification",title:"Contact and history checks",description:"Resolve the contact, delivery or history question before outreach."},
  {key:"calls",title:"Call or relationship review",description:"Check offline outcomes before acting on the existing call or customer-specific next step."},
  {key:"first_followup",title:"First-follow-up candidates",description:"Candidates for one personalized draft after checking current replies and offline activity."},
] as const;
export function attentionDay(now=new Date()) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Denver",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
export function groupAttentionNotices(notices:AttentionNotice[],today:string) {
  const groups:Record<ReviewGroup|"due"|"upcoming"|"dormant"|"pastEvents"|"other",AttentionNotice[]>={owner:[],drafts:[],calls:[],first_followup:[],verification:[],outdated:[],due:[],upcoming:[],waiting:[],dormant:[],pastEvents:[],other:[]};
  for(const notice of notices){
    if(notice.deadlineKind==="next_action" && notice.attentionReview && Object.hasOwn(groups,notice.attentionReview.group)) groups[notice.attentionReview.group].push(notice);
    else if(notice.attentionState==="waiting_reply" && notice.deadlineKind==="next_action") groups.waiting.push(notice);
    else if(notice.triggerType==="inactive") groups.dormant.push(notice);
    else if(notice.deadlineKind==="event" && notice.dueOn && notice.dueOn<today) groups.pastEvents.push(notice);
    else if(notice.dueOn && notice.dueOn<=today) groups.due.push(notice);
    else if(notice.dueOn && notice.dueOn>today) groups.upcoming.push(notice);
    else groups.other.push(notice);
  }
  for(const group of Object.values(groups)) group.sort((a,b)=>(a.dueOn??"").localeCompare(b.dueOn??"")||a.profileName.localeCompare(b.profileName)||a.id.localeCompare(b.id));
  return groups;
}
function NoticeList({notices,label,onDismiss}:{notices:AttentionNotice[];label:string;onDismiss:(id:string)=>void}){
  const [limit,setLimit]=useState(50);
  return <>
    {!notices.length?<p className="mt-3 text-sm text-muted-foreground">No reminders in this section.</p>:null}
    <ul className="mt-2 max-h-96 overflow-auto divide-y divide-border">{notices.slice(0,limit).map(n=><li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><Link href={`/profiles/${n.organizationId}`} className="font-semibold text-primary underline">{n.profileName}</Link>
        {n.attentionReview?<><p className="mt-1 text-sm">{n.attentionReview.nextAction}</p><p className="mt-1 text-xs text-muted-foreground">Reviewed {n.attentionReview.reviewedOn} · Check for newer activity before acting.</p><details className="mt-2"><summary className="cursor-pointer text-sm underline">Original reminder</summary><p className="text-sm">{n.title}</p></details></>:<p className="text-sm">{n.title}</p>}
        {n.dueOn?<p className="text-xs text-muted-foreground">Original date: {n.dueOn}</p>:null}</div>
      <button type="button" className="button-secondary" aria-label={`Dismiss ${n.profileName}: ${n.title}`} onClick={()=>onDismiss(n.id)}>Dismiss</button>
    </li>)}</ul>
    {notices.length>limit?<button type="button" className="button-secondary mt-3" onClick={()=>setLimit(n=>n+50)}>Show more {label.toLowerCase()}</button>:null}
    {notices.length>50?<p className="mt-2 text-xs text-muted-foreground">Showing {Math.min(limit,notices.length)} of {notices.length}</p>:null}
  </>;
}
function SecondarySection({title,description,notices,onDismiss}:{title:string;description:string;notices:AttentionNotice[];onDismiss:(id:string)=>void}){
  const [open,setOpen]=useState(false);
  return <details className="rounded-xl border border-border bg-card p-4" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-lg font-bold">{title} ({notices.length})</summary>
    <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    {open?<NoticeList notices={notices} label={title} onDismiss={onDismiss}/>:null}
  </details>;
}
export function AttentionView({notices,today=attentionDay(),onDismiss}:{notices:AttentionNotice[];today?:string;onDismiss:(id:string)=>void}){
  const groups=groupAttentionNotices(notices,today);
  const reviewedCount=notices.filter(n=>n.attentionReview).length;
  return <div className="grid gap-4">
    <p className="text-sm text-muted-foreground">{notices.length} active reminders across all sections. Dates use Mountain time. Opening a section does not mark anything done.</p>
    {reviewedCount>0?<><p className="text-sm text-muted-foreground">{reviewedCount} reminders have saved reviews. These groups organize the work; they do not change reminder rules or completion status. Reviews are snapshots, not live mailbox monitoring. Edited tasks return to their date section until reviewed again.</p>
      <nav aria-label="Attention sections" className="flex flex-wrap gap-2">{actionSections.map(s=><a key={s.key} href={`#attention-${s.key}`} className="button-secondary">{s.title} ({groups[s.key].length})</a>)}<a href="#attention-waiting" className="button-secondary">Waiting ({groups.waiting.length})</a><a href="#attention-outdated" className="button-secondary">Outdated / overlapping ({groups.outdated.length})</a></nav></>:null}
    {actionSections.filter(s=>groups[s.key].length>0).map(s=><section id={`attention-${s.key}`} key={s.key} className="rounded-xl border border-primary/30 bg-card p-4"><h2 className="text-lg font-bold">{s.title} ({groups[s.key].length})</h2><p className="text-sm text-muted-foreground">{s.description}</p><NoticeList notices={groups[s.key]} label={s.title} onDismiss={onDismiss}/></section>)}
    <section className="rounded-xl border border-primary/30 bg-card p-4"><h2 className="text-lg font-bold">{reviewedCount?"Other due reminders to review":"Due now"} ({groups.due.length})</h2><p className="text-sm text-muted-foreground">Today and overdue work without a current review group. This includes tasks needing context; it is not a list of confirmed next actions.</p><NoticeList notices={groups.due} label="Due now" onDismiss={onDismiss}/></section>
    <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Upcoming ({groups.upcoming.length})</h2><p className="text-sm text-muted-foreground">Future reminders, soonest first.</p><NoticeList notices={groups.upcoming} label="Upcoming" onDismiss={onDismiss}/></section>
    <section id="attention-waiting" className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Waiting on replies ({groups.waiting.length})</h2><p className="text-sm text-muted-foreground">Waiting, recently contacted, or a future planning checkpoint. Original dates remain visible. Check the latest email before acting; this section does not monitor the mailbox or mark work done.</p><NoticeList notices={groups.waiting} label="Waiting on replies" onDismiss={onDismiss}/></section>
    {groups.outdated.length?<section id="attention-outdated" className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Outdated or overlapping reminders ({groups.outdated.length})</h2><p className="text-sm text-muted-foreground">Newer evidence or another task changes the next step. All reminders and history are retained; nothing here has been marked done.</p><NoticeList notices={groups.outdated} label="Outdated or overlapping reminders" onDismiss={onDismiss}/></section>:null}
    <SecondarySection title="Dormant prospects" description="No recent activity. These are outreach opportunities, not dated commitments." notices={groups.dormant} onDismiss={onDismiss}/>
    <SecondarySection title="Past event dates" description="The event date has passed. Review the profile for unfinished work; these reminders have not been completed or dismissed." notices={groups.pastEvents} onDismiss={onDismiss}/>
    {groups.other.length?<section className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Other reminders ({groups.other.length})</h2><p className="text-sm text-muted-foreground">Undated reminders that need review.</p><NoticeList notices={groups.other} label="Other reminders" onDismiss={onDismiss}/></section>:null}
  </div>;
}
