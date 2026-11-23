import { useEffect, useRef, useState } from "react";
import { getCoverageProfile, reviewCoverageFact, type CoverageFact } from "@/features/event-date-coverage/event-date-coverage-api";

type Props = { profileId:string; onApplied?:()=>void|Promise<void>; bookingTakesPriority?:boolean };
type Decision = "approve_confirmed" | "approve_expected";

function dateRange(fact: CoverageFact) {
  const format = (value:string) => new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));
  return format(fact.startsOn) + (fact.endsOn && fact.endsOn !== fact.startsOn ? ` – ${format(fact.endsOn)}` : "");
}

export function ProfileEventDateReview(props:Props) {
  // A profile switch must discard an in-flight review and its selected fact.
  return <DateReview key={props.profileId} {...props} />;
}

function DateReview({profileId,onApplied,bookingTakesPriority}:Props) {
  const [open,setOpen] = useState(false);
  const [facts,setFacts] = useState<CoverageFact[]>([]);
  const [loading,setLoading] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [busy,setBusy] = useState(false);
  const [reload,setReload] = useState(0);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [selection,setSelection] = useState<{fact:CoverageFact;decision:Decision}|null>(null);
  const saving = useRef(false);
  const alive = useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

  useEffect(()=>{
    if(!open) return;
    let cancelled=false;
    setLoading(true); setLoaded(false); setError(""); setSelection(null);
    getCoverageProfile(profileId).then(result=>{
      if(result.organizationId !== profileId) throw Error("The date evidence does not match this profile.");
      if(!cancelled) { setFacts(result.facts); setLoaded(true); }
    }).catch(cause=>{if(!cancelled) setError(cause instanceof Error?cause.message:"Could not load event dates.");})
      .finally(()=>{if(!cancelled) setLoading(false);});
    return()=>{cancelled=true;};
  },[profileId,open,reload]);

  async function apply() {
    if(!selection || saving.current) return;
    saving.current=true; setBusy(true); setError(""); setMessage("");
    const {fact,decision}=selection;
    let submitted=false;
    try {
      await reviewCoverageFact(fact.id,decision);
      submitted=true;
      const latest=await getCoverageProfile(profileId);
      const approved=latest.facts.find(item=>item.id===fact.id);
      if(latest.organizationId!==profileId || !approved?.active || approved.status!==(decision==="approve_confirmed"?"confirmed":"expected") || approved.startsOn!==fact.startsOn || approved.endsOn!==fact.endsOn)
        throw Error("The review was submitted, but we could not verify the active dates. Reload dates before trying again.");
      if(!alive.current) return;
      setFacts(latest.facts); setSelection(null); setMessage(`Event dates updated: ${dateRange(approved)}.`);
      try { await onApplied?.(); }
      catch { if(alive.current) setError("The dates were saved, but the profile could not refresh. Reload the profile to see the updated At-a-glance date."); }
    } catch(cause) {
      if(alive.current) setError(submitted?"The review was submitted, but we could not verify the active dates. Reload dates before trying again.":cause instanceof Error?cause.message:"Could not save the date correction.");
    } finally {
      saving.current=false;
      if(alive.current) setBusy(false);
    }
  }

  const current=facts.filter(fact=>fact.active);
  const pending=facts.filter(fact=>!fact.active && fact.status==="needs_review" && !fact.supersededById);
  function evidence(fact:CoverageFact) {
    let source:string|null=null;
    try { if(fact.sourceUrl && ["http:","https:"].includes(new URL(fact.sourceUrl).protocol)) source=fact.sourceUrl; } catch { /* Show rationale when no usable URL is saved. */ }
    return <><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{fact.rationale}</p>{source?<a className="mt-2 inline-block break-words text-sm font-semibold text-primary underline" href={source} target="_blank" rel="noreferrer noopener">{fact.sourceTitle||"View source"}</a>:null}</>;
  }

  return <div className="mt-3">
    <button className="text-sm font-semibold text-primary underline" type="button" aria-expanded={open} disabled={busy} onClick={()=>setOpen(value=>!value)}>Review event dates</button>
    {open?<section aria-label="Review event dates" className="mt-3 rounded-md border border-border bg-background p-4">
      <h3 className="font-bold">Resolve event date conflicts</h3>
      <p className="mt-1 text-sm text-muted-foreground">Compare the saved dates and evidence. Applying a correction keeps the previous dates in history.</p>
      {bookingTakesPriority?<p className="mt-2 text-sm font-semibold">At a glance uses the booking's dates. Reviewing event evidence does not change that booking.</p>:null}
      {loading?<p className="mt-3 text-sm">Loading dates…</p>:null}
      {error?<p className="mt-3 text-sm text-destructive" role="alert">{error}</p>:null}
      {message?<p className="mt-3 text-sm font-semibold" role="status">{message}</p>:null}
      {!loading && loaded?<>
        <section aria-label="Current event dates" className="mt-3 rounded-md border border-border p-3">
          <h4 className="text-sm font-bold">Current event dates</h4>
          {current.length?current.map(fact=><div key={fact.id}><p className="mt-1 font-semibold">{dateRange(fact)}</p>{evidence(fact)}</div>):<p className="mt-1 text-sm text-muted-foreground">No active event date recorded.</p>}
        </section>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{pending.map(fact=><article key={fact.id} className="min-w-0 rounded-md border border-border p-3">
          <h4 className="text-sm font-bold">Proposed correction</h4><p className="mt-1 font-semibold">{dateRange(fact)}</p>{evidence(fact)}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="button-primary" disabled={busy} onClick={()=>{setSelection({fact,decision:"approve_confirmed"});setError("");}}>Use as confirmed</button>
            <button type="button" className="button-secondary" disabled={busy} onClick={()=>{setSelection({fact,decision:"approve_expected"});setError("");}}>Use as estimated</button>
          </div>
        </article>)}</div>
        {!facts.length?<p className="mt-3 text-sm">No saved event dates to review.</p>:!pending.length?<p className="mt-3 text-sm text-muted-foreground">No pending date conflicts.</p>:null}
      </>:null}
      {selection?<fieldset aria-label="Confirm date correction" className="mt-3 rounded-md border border-primary p-3">
        <legend className="px-1 text-sm font-bold">Confirm date correction</legend>
        <p className="text-sm">Replace {current.length?current.map(dateRange).join(", "):"the empty event date"} with <strong>{dateRange(selection.fact)}</strong> as {selection.decision==="approve_confirmed"?"confirmed":"estimated"}?</p>
        <p className="mt-1 text-xs text-muted-foreground">Calendar events, site access, bookings and follow-ups are unchanged.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className="button-primary" type="button" disabled={busy} onClick={()=>void apply()}>{busy?"Saving correction…":"Confirm date correction"}</button><button className="button-secondary" type="button" disabled={busy} onClick={()=>setSelection(null)}>Cancel correction</button></div>
      </fieldset>:null}
      <button className="mt-3 text-sm font-semibold text-primary underline" disabled={busy||loading} type="button" onClick={()=>{setMessage("");setReload(value=>value+1);}}>Reload dates</button>
    </section>:null}
  </div>;
}
