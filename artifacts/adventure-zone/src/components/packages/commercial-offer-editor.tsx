import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";

type Offer = {
  id:string;code:string;name:string;kind:"discount"|"payment_option"|"fee";state:"proposed"|"active"|"archived";audience:"owner_only"|"customer_safe";
  calculationType:"fixed_cents"|"percent_basis_points"|"revenue_share"|"variable";amountCents:number|null;amountBasisPoints:number|null;calculationScope:string|null;
  stackPolicy:"stackable"|"exclusive"|"manual";appliesToPackageCodes:string[];newCustomerOnly:boolean;repeatCustomerOnly:boolean;requiresOwnerConfirmation:boolean;
  deadlineMode:"none"|"manual"|"days_after_trigger"|"fixed_date";deadlineDays:number|null;fixedDeadline:string|null;customerSummary:string|null;internalConditions:string;sourceConflictNote:string|null;
};

type EditableOffer = Omit<Offer,"id"|"state">;

function editableOfferPayload(offer:Offer):EditableOffer{
  const {id:_id,state:_state,...editable}=offer;
  return editable;
}

function percent(value:number|null){return value==null?"":String(value/100)}
function dollars(value:number|null){return value==null?"":String(value/100)}

function OfferCard({initial,onReload}:{initial:Offer;onReload:()=>Promise<void>}){
  const [offer,setOffer]=useState(initial);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
  useEffect(()=>setOffer(initial),[initial]);
  function set<K extends keyof Offer>(key:K,value:Offer[K]){setOffer((current)=>({...current,[key]:value}));setMessage("");}
  async function save(){setBusy(true);setError("");try{await apiPatch(`/commercial-offers/${offer.id}`,editableOfferPayload(offer));setMessage("Offer saved.");await onReload();}catch(e){setError(e instanceof Error?e.message:"Could not save offer.");}finally{setBusy(false)}}
  async function action(kind:"activate"|"archive"){setBusy(true);setError("");try{await apiPost(`/commercial-offers/${offer.id}/${kind}`,{});setMessage(kind==="activate"?"Offer activated.":"Offer archived.");await onReload();}catch(e){setError(e instanceof Error?e.message:`Could not ${kind} offer.`);}finally{setBusy(false)}}
  return <article className="grid gap-3 rounded-xl border border-slate-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{offer.code}</p><input className="mt-1 font-bold" value={offer.name} onChange={(e)=>set("name",e.target.value)}/></div><div className="flex gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{offer.state}</span>{offer.audience==="owner_only"?<span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-bold text-violet-800">Owner only</span>:null}</div></div>
    {offer.sourceConflictNote?<div className="rounded-lg border border-amber-300 bg-amber-50 p-3"><p className="font-bold text-amber-950">Source conflict</p><p className="mt-1 text-sm text-amber-900">{offer.sourceConflictNote}</p><button className="button-secondary mt-2" type="button" onClick={()=>set("sourceConflictNote",null)}>I confirmed the current terms</button></div>:null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm font-semibold">Audience<select value={offer.audience} onChange={(e)=>set("audience",e.target.value as Offer["audience"])}><option value="customer_safe">Customer safe</option><option value="owner_only">Owner only</option></select></label>
      <label className="grid gap-1 text-sm font-semibold">Calculation<select value={offer.calculationType} onChange={(e)=>set("calculationType",e.target.value as Offer["calculationType"])}><option value="fixed_cents">Fixed amount</option><option value="percent_basis_points">Percent</option><option value="revenue_share">Revenue share</option><option value="variable">Variable</option></select></label>
      {offer.calculationType==="fixed_cents"?<label className="grid gap-1 text-sm font-semibold">Amount ($)<input type="number" min="0" step="0.01" value={dollars(offer.amountCents)} onChange={(e)=>set("amountCents",e.target.value===""?null:Math.round(Number(e.target.value)*100))}/></label>:null}
      {offer.calculationType==="percent_basis_points"?<label className="grid gap-1 text-sm font-semibold">Percent<input type="number" min="0" max="100" step="0.01" value={percent(offer.amountBasisPoints)} onChange={(e)=>set("amountBasisPoints",e.target.value===""?null:Math.round(Number(e.target.value)*100))}/></label>:null}
      <label className="grid gap-1 text-sm font-semibold">Stacking<select value={offer.stackPolicy} onChange={(e)=>set("stackPolicy",e.target.value as Offer["stackPolicy"])}><option value="manual">Owner decides</option><option value="exclusive">Exclusive</option><option value="stackable">Stackable</option></select></label>
    </div>
    <label className="grid gap-1 text-sm font-semibold">Calculation scope<input value={offer.calculationScope??""} onChange={(e)=>set("calculationScope",e.target.value||null)}/></label>
    <label className="grid gap-1 text-sm font-semibold">Package codes <span className="font-normal text-slate-500">(comma separated; blank means any package)</span><input value={offer.appliesToPackageCodes.join(", ")} onChange={(e)=>set("appliesToPackageCodes",e.target.value.split(",").map((x)=>x.trim()).filter(Boolean))}/></label>
    <div className="flex flex-wrap gap-4 text-sm font-semibold"><label><input type="checkbox" checked={offer.newCustomerOnly} onChange={(e)=>set("newCustomerOnly",e.target.checked)}/> New customers only</label><label><input type="checkbox" checked={offer.repeatCustomerOnly} onChange={(e)=>set("repeatCustomerOnly",e.target.checked)}/> Repeat customers only</label><label><input type="checkbox" checked={offer.requiresOwnerConfirmation} onChange={(e)=>set("requiresOwnerConfirmation",e.target.checked)}/> Require owner confirmation per event</label></div>
    <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-sm font-semibold">Deadline<select value={offer.deadlineMode} onChange={(e)=>set("deadlineMode",e.target.value as Offer["deadlineMode"])}><option value="none">No deadline</option><option value="manual">Needs current deadline</option><option value="days_after_trigger">Days after trigger</option><option value="fixed_date">Fixed date</option></select></label>{offer.deadlineMode==="days_after_trigger"?<label className="grid gap-1 text-sm font-semibold">Days<input type="number" min="0" value={offer.deadlineDays??""} onChange={(e)=>set("deadlineDays",e.target.value===""?null:Number(e.target.value))}/></label>:null}{offer.deadlineMode==="fixed_date"?<label className="grid gap-1 text-sm font-semibold">Date<input type="date" value={offer.fixedDeadline??""} onChange={(e)=>set("fixedDeadline",e.target.value||null)}/></label>:null}</div>
    {offer.audience==="customer_safe"?<label className="grid gap-1 text-sm font-semibold">Customer explanation<textarea rows={3} value={offer.customerSummary??""} onChange={(e)=>set("customerSummary",e.target.value||null)}/></label>:null}
    <label className="grid gap-1 text-sm font-semibold">Internal conditions<textarea rows={4} value={offer.internalConditions} onChange={(e)=>set("internalConditions",e.target.value)}/></label>
    {error?<p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p>:null}{message?<p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{message}</p>:null}
    <div className="flex flex-wrap gap-2"><button className="button-secondary" disabled={busy} type="button" onClick={()=>void save()}>Save</button>{offer.state!=="active"?<button className="button-primary" disabled={busy} type="button" onClick={()=>void action("activate")}>Activate</button>:null}{offer.state!=="archived"?<button className="button-secondary" disabled={busy} type="button" onClick={()=>void action("archive")}>Archive</button>:null}</div>
  </article>;
}

export function CommercialOfferEditor(){const [offers,setOffers]=useState<Offer[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");async function load(){try{const data=await apiGet<{offers:Offer[]}>("/commercial-offers");setOffers(data.offers);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load offers.");}finally{setLoading(false)}}useEffect(()=>{void load()},[]);return <section className="grid gap-4"><div><h3 className="text-lg font-bold">Offers & Discounts</h3><p className="text-sm text-slate-600">Source-derived offers begin Proposed. Review the current terms before activating anything.</p></div>{loading?<p className="text-sm text-slate-500">Loading offers…</p>:null}{error?<p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}{offers.map((offer)=><OfferCard key={offer.id} initial={offer} onReload={load}/>)}</section>}
