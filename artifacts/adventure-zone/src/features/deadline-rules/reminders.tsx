import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AttentionView, type AttentionNotice } from "./attention-view";
import { Bell } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/auth-token";

type Item={sourceKey:string;organizationId:string;profileName:string;kind:string;label:string;dueOn:string|null;offsets:number[]|null;completed:boolean;editable:boolean};
type Notice=AttentionNotice;
type Summary={upcoming:Item[];notifications:Notice[];count:number;lastEvaluatedAt:string|null};
const Context=createContext<{data:Summary|null;error:string;refresh:()=>Promise<void>}>({data:null,error:"",refresh:async()=>{}});
export function RemindersProvider({children}:{children:ReactNode}) {
  const [data,setData]=useState<Summary|null>(null),[error,setError]=useState("");
  const [location]=useLocation();
  const fullDetails=location==="/leads" || location==="/settings/reminders";
  const requestVersion=useRef(0),viewVersion=useRef(0);
  const load=useCallback(async()=>{
    const version=++requestVersion.current;
    try{
      const result=fullDetails
        ? await apiGet<Summary>("/deadline-rules/summary")
        : { ...await apiGet<Pick<Summary,"count"|"lastEvaluatedAt">>("/deadline-rules/badge"), upcoming:[], notifications:[] };
      if(version===requestVersion.current){setData(result);setError("");}
    }catch{if(version===requestVersion.current)setError("Reminders could not be checked. Try again.");}
  },[fullDetails]);
  const refresh=useCallback(async()=>{
    const view=viewVersion.current;
    try{await apiPost("/deadline-rules/evaluate",{});if(view===viewVersion.current)await load();}
    catch{if(view===viewVersion.current)setError("Reminders could not be checked. Try again.");}
  },[load]);
  useEffect(()=>{
    if(fullDetails)setData(null);
    void load();
    const timer=setInterval(()=>{if(!document.hidden)void load();},5*60*1000);
    return()=>{clearInterval(timer);requestVersion.current++;viewVersion.current++;};
  },[load,fullDetails]);
  return <Context.Provider value={{data,error,refresh}}>{children}</Context.Provider>;
}
export function ReminderBell(){
  const {data,error}=useContext(Context);
  return <Link href="/settings/reminders" aria-label={error?"Reminders need attention":`Reminders, ${data?.count??0} active`}
    className="button-secondary inline-flex min-h-10 items-center gap-2">
    <Bell className="h-4 w-4" aria-hidden="true"/><span>Reminders</span>
    <span className="rounded-full bg-primary px-2 text-primary-foreground">{error?"!":data?.count??0}</span>
  </Link>;
}
export function UpcomingDeadlines(){
  const {data,error,refresh}=useContext(Context);
  return <section className="rounded-xl border border-border bg-card p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">Upcoming deadlines</h2><Link href="/settings/reminders" className="text-primary underline">All reminders &amp; rules</Link></div>
    <p className="text-sm text-muted-foreground">Next 30 days · Mountain time</p>
    {error?<p role="alert">{error} <button type="button" className="underline" onClick={()=>void refresh()}>Retry</button></p>:null}
    {!data&&!error?<p>Checking deadlines…</p>:null}
    {data&&!data.upcoming.length?<p className="mt-2 text-sm text-muted-foreground">No deadlines in the next 30 days.</p>:null}
    <ul className="mt-3 max-h-80 overflow-auto divide-y divide-border">{data?.upcoming.map(item=><li key={item.sourceKey} className="py-2">
      <Link href={`/profiles/${item.organizationId}`} className="font-semibold text-primary underline">{item.profileName}</Link>
      <p className="text-sm">{item.label} · {item.dueOn??"Not set"}</p>
    </li>)}</ul>
  </section>;
}
const labels:Record<string,string>={event:"Event date",vendor:"Vendor deadline",application:"Application deadline",balance_due:"Balance-due date",next_action:"Next-action date"};
function DeadlineEditor({item,onSaved}:{item:Item;onSaved:()=>Promise<void>}){
  const [date,setDate]=useState(item.dueOn??""),[days,setDays]=useState((item.offsets??[14,7]).join(", ")),[done,setDone]=useState(item.completed);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setDate(item.dueOn??"");setDays((item.offsets??[14,7]).join(", "));setDone(item.completed);},[item]);
  async function save(){
    const offsets=days.trim()?days.split(",").map(v=>Number(v.trim())):[];
    if(offsets.some(v=>!Number.isInteger(v)||v<0||v>3650)||offsets.length>10){setError("Use up to 10 whole numbers between 0 and 3650.");return;}
    setBusy(true);setError("");
    try{await apiPut(`/deadline-rules/profiles/${item.organizationId}/item`,{sourceKey:item.sourceKey,...(item.editable?{dueOn:date||null}:{}),offsets,completed:done});await onSaved();}
    catch(e){setError(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}
  }
  return <div className="grid gap-2 rounded-lg border border-border p-3">
    <p className="font-semibold">{item.label}</p>
    <p className="text-sm">{labels[item.kind]}: {item.dueOn??"Not set"}</p>
    {item.editable?<label className="grid gap-1 text-sm">Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>:<p className="text-xs text-muted-foreground">Date comes from the existing booking, invoice, event dates, or follow-up. Edit it there.</p>}
    <label className="grid gap-1 text-sm">Remind me this many days before<input type="text" value={days} placeholder="14, 7" onChange={e=>setDays(e.target.value)}/></label>
    <p className="text-xs text-muted-foreground">Separate days with commas. Leave blank for no advance reminders.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={done} onChange={e=>setDone(e.target.checked)}/>Done — stop reminders for this date</label>
    <button type="button" className="button-secondary justify-self-start" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save reminder"}</button>
    {error?<p role="alert">{error}</p>:null}
  </div>;
}
export function ProfileDeadlines({profileId}:{profileId:string}){
  const [items,setItems]=useState<Item[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [kind,setKind]=useState("vendor"),[label,setLabel]=useState(""),[date,setDate]=useState("");
  const {refresh}=useContext(Context);
  const load=useCallback(async()=>{try{const result=await apiGet<{items:Item[]}>(`/deadline-rules/profiles/${profileId}`);setItems(result.items);setError("");}catch{setError("Could not load deadlines.");}},[profileId]);
  useEffect(()=>{void load();},[load]);
  async function saved(){await load();await refresh();}
  async function add(){
    setBusy(true);setError("");
    try{await apiPost(`/deadline-rules/profiles/${profileId}`,{kind,label:label.trim()||labels[kind],dueOn:date||null});setLabel("");setDate("");await saved();}
    catch{setError("Could not add deadline.");}finally{setBusy(false);}
  }
  return <details className="rounded-xl border border-border bg-card p-4">
    <summary className="cursor-pointer font-bold">Dates &amp; deadline reminders</summary>
    <div className="mt-4 grid gap-3">
      {error?<p role="alert">{error} <button type="button" onClick={()=>void load()}>Retry</button></p>:null}
      {Object.entries(labels).filter(([key])=>!items.some(i=>i.kind===key)).map(([key,name])=><p key={key} className="text-sm">{name}: Not set</p>)}
      {items.map(item=><DeadlineEditor key={item.sourceKey} item={item} onSaved={saved}/>)}
      <form className="grid gap-2 border-t border-border pt-3" onSubmit={e=>{e.preventDefault();void add();}}>
        <h3 className="font-semibold">Add a dated item</h3>
        <label className="grid gap-1 text-sm">Type<select value={kind} onChange={e=>setKind(e.target.value)}>
          {Object.entries(labels).filter(([key])=>key!=="application").map(([key,name])=><option key={key} value={key}>{name}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm">Label<input type="text" maxLength={160} value={label} placeholder={labels[kind]} onChange={e=>setLabel(e.target.value)}/></label>
        <label className="grid gap-1 text-sm">Date (optional)<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <button type="submit" disabled={busy} className="button-primary justify-self-start">{busy?"Adding…":"Add dated item"}</button>
      </form>
    </div>
  </details>;
}
type Rule={id:string;name:string;enabled:boolean;trigger:{type:string;days?:number|number[];useItemOffsets?:boolean;status?:string};actions:string[]};
function RuleEditor({rule,onSaved}:{rule?:Rule;onSaved:()=>Promise<void>}){
  const [name,setName]=useState(rule?.name??""),[type,setType]=useState(rule?.trigger.type??"deadline_before");
  const [days,setDays]=useState(Array.isArray(rule?.trigger.days)?rule!.trigger.days!.join(", "):String(rule?.trigger.days??"14, 7"));
  const [status,setStatus]=useState(rule?.trigger.status??""),[actions,setActions]=useState(rule?.actions??["notify","badge"]);
  const [enabled,setEnabled]=useState(rule?.enabled??true),[useOffsets,setUseOffsets]=useState(rule?.trigger.useItemOffsets??true);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function save(nextEnabled=enabled){
    setError("");setBusy(true);
    const trigger=type==="deadline_before"?{type,days:days.split(",").map(v=>Number(v.trim())),useItemOffsets:useOffsets}
      :type==="inactive"?{type,days:Number(days)}:type==="status_changed"?{type,...(status.trim()?{status:status.trim()}:{})}:{type};
    try{
      const input={name,enabled:nextEnabled,trigger,actions};
      if(rule)await apiPut(`/deadline-rules/${rule.id}`,input);else await apiPost("/deadline-rules",input);
      await onSaved();
      if(!rule)setName("");
    }catch(e){setError(e instanceof Error?e.message:"Could not save rule.");}finally{setBusy(false);}
  }
  return <form className="grid gap-3 rounded-xl border border-border bg-card p-4" onSubmit={e=>{e.preventDefault();void save();}}>
    <label className="grid gap-1 text-sm">Rule name<input type="text" required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={enabled} disabled={busy}
      onChange={e=>{setEnabled(e.target.checked);if(rule)void save(e.target.checked);}}/>On</label>
    <label className="grid gap-1 text-sm">When<select value={type} onChange={e=>{setType(e.target.value);setDays(e.target.value==="inactive"?"21":"14, 7");}}>
      <option value="deadline_before">Deadline is N days away</option><option value="deadline_passed">Deadline has passed</option>
      <option value="inactive">No activity on prospect for N days</option><option value="status_changed">Profile booking status changed</option>
    </select></label>
    {(type==="deadline_before"||type==="inactive")?<label className="grid gap-1 text-sm">Days<input type="text" required value={days} onChange={e=>setDays(e.target.value)}/></label>:null}
    {type==="deadline_before"?<label className="flex gap-2 text-sm"><input type="checkbox" checked={useOffsets} onChange={e=>setUseOffsets(e.target.checked)}/>Use each item's reminder days when set</label>:null}
    {type==="status_changed"?<label className="grid gap-1 text-sm">New status (blank means any)<select value={status} onChange={e=>setStatus(e.target.value)}>
      <option value="">Any status</option>{["new_lead","researching","contact_due","contacted","interested","possible","unlikely","quote_sent","pending_decision","pending_contract","contract_received","confirmed","declined","cancelled","completed","renewal_due"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}
    </select></label>:null}
    <fieldset className="grid gap-2"><legend className="text-sm font-semibold">Actions</legend>
      {[["notify","Show in-app notification"],["badge","Update reminder badge"],["next_action","Create or update a next action"],["email","Email reminder (provider not configured)"]].map(([value,title])=><label key={value} className="flex gap-2 text-sm">
        <input type="checkbox" checked={actions.includes(value)} onChange={e=>setActions(current=>e.target.checked?[...current,value]:current.filter(a=>a!==value))}/>{title}
      </label>)}
    </fieldset>
    <button type="submit" disabled={busy} className="button-primary justify-self-start">{busy?"Saving…":rule?"Save rule":"Add rule"}</button>
    {error?<p role="alert">{error}</p>:null}
  </form>;
}
export function RemindersPage(){
  const {data,error,refresh}=useContext(Context);
  const [rules,setRules]=useState<Rule[]>([]),[ruleError,setRuleError]=useState(""),[email,setEmail]=useState({enabled:false,providerConfigured:false});
  async function load(){try{const result=await apiGet<{rules:Rule[];email:typeof email}>("/deadline-rules");setRules(result.rules);setEmail(result.email);setRuleError("");}catch{setRuleError("Could not load rules.");}}
  useEffect(()=>{void load();},[]);
  async function saved(){await load();await refresh();}
  async function dismiss(id:string){try{await apiPost(`/deadline-rules/notifications/${id}/dismiss`,{});await refresh();}catch{setRuleError("Could not dismiss reminder.");}}
  return <div className="mx-auto grid max-w-5xl gap-5">
    <header><h1 className="text-2xl font-bold">Attention view</h1><p className="text-sm text-muted-foreground">Dates use Mountain time. Checks run every 15 minutes while the app server is awake. Use Check reminders to run a check now.</p></header>
    <button type="button" className="button-secondary justify-self-start" onClick={()=>void refresh()}>Check reminders</button>
    {error?<p role="alert">{error}</p>:null}
    {ruleError?<p role="alert">{ruleError} <button type="button" onClick={()=>void load()}>Retry</button></p>:null}
    {!data&&!error?<p role="status">Loading reminders…</p>:null}
    {data?<AttentionView notices={data.notifications} onDismiss={id=>void dismiss(id)}/>:null}
    <p className="text-xs text-muted-foreground">Last checked: {data?.lastEvaluatedAt?new Date(data.lastEvaluatedAt).toLocaleString("en-US",{timeZone:"America/Denver"}):"Not yet"}</p>
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-bold">All upcoming dates · next 30 days</summary><div className="mt-3"><UpcomingDeadlines/></div></details>
    <section className="grid gap-3"><h2 className="text-xl font-bold">Automation rules</h2>{rules.map(rule=><RuleEditor key={rule.id+JSON.stringify(rule)} rule={rule} onSaved={saved}/>)}</section>
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-bold">Add a rule</summary><div className="mt-3"><RuleEditor onSaved={saved}/></div></details>
    <section className="rounded-xl border border-border bg-card p-4"><h2 className="text-lg font-bold">Email reminder setup</h2>
      <p>Email reminders: {email.enabled?"Enabled flag; no provider connected":"Off (default)"}. No email will be sent.</p>
      <p className="mt-2 text-sm">Future setup: choose an SMTP or email API provider and your own reminder recipient address. Its adapter and credentials belong on the server in Render, never in this page or browser. Existing Gmail sending is not used.</p>
      <label className="mt-3 grid gap-1 text-sm">SMTP / email API credentials (not configured)<input disabled type="password" placeholder="Server-side setup required"/></label>
    </section>
  </div>;
}
