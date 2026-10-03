import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { MapEvent } from "@/features/routes/map-data";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { timelineWindow, timelinePlacement, stopContext } from "@/features/routes/leg-timeline";
import { classifyRouteBucket } from "@/features/routes/route-view";
import { operationsScheduleHref } from "@/features/bookings/operations-navigation";
type Props={events:MapEvent[];legs:TravelLeg[];season:number;focusedLegId:string|null;selectedId:string|null;previewLegId:string|null;
 contextEvents?:MapEvent[];renderSelectedDetails?:(id:string)=>ReactNode;onSelect:(id:string)=>void;onPreviewLeg:(id:string|null)=>void;profileBasePath:string};
const bucket=(e:MapEvent)=>e.routeBucket??classifyRouteBucket(e.status,e.probability);
const label=(e:MapEvent)=>bucket(e)==="history"?"Historical":bucket(e)==="confirmed"?"Confirmed":"Proposed";
export function LegTimeline({events,legs,season,focusedLegId,selectedId,previewLegId,onSelect,onPreviewLeg,profileBasePath,contextEvents=events,renderSelectedDetails}:Props){
 const [month,setMonth]=useState<number|null>(null);
 const [expandedDetails,setExpandedDetails]=useState<string|null>(null);
 const selected=events.find(e=>e.id===selectedId)??null;
 const selectedLeg=previewLegId??selected?.travelLegId??focusedLegId;
 const context=selected?stopContext(contextEvents,selected,selectedLeg):null;
 const rows=useMemo(()=>{
  const visible=legs.filter(l=>(!l.archivedAt||events.some(e=>e.travelLegId===l.id))&&(!focusedLegId||l.id===focusedLegId));
  return visible.map(leg=>{
   const stops=events.filter(e=>e.travelLegId===leg.id).map(event=>({event,window:timelineWindow(event)}))
    .filter(x=>x.window!==null).sort((a,b)=>a.window!.start-b.window!.start||a.event.id.localeCompare(b.event.id));
   const laneEnds:number[]=[];
   const bars=stops.flatMap(({event,window})=>{
    const placement=timelinePlacement(window!,season,month);if(!placement)return [];
    let lane=laneEnds.findIndex(end=>end<window!.start);if(lane<0)lane=laneEnds.length;
    laneEnds[lane]=Math.max(window!.end,window!.start+(month===null?15:2));
    const overlaps=stopContext(contextEvents,event,leg.id).overlaps;
    return [{event,window:window!,placement,lane,overlaps}];
   });
   return {leg,bars,height:Math.max(64,laneEnds.length*58+8)};
  });
 },[events,contextEvents,legs,season,focusedLegId,month]);
 const unassigned=events.filter(e=>!e.travelLegId||e.travelLegAssignmentKind==="suggested");
 const invalid=events.filter(e=>!timelineWindow(e));
 function inspect(event:MapEvent){onSelect(event.id);setExpandedDetails(null);}
 const eventButton=(event:MapEvent)=><button key={event.id} type="button" aria-label={"Inspect "+event.name} aria-pressed={selectedId===event.id} className="min-h-11 rounded-lg border px-3 py-2 text-left text-sm hover:bg-orange-50" onClick={()=>inspect(event)}><strong>{event.name}</strong><span className="block text-xs">{[event.city,event.region].filter(Boolean).join(", ")} · {label(event)}{event.travelLegAssignmentKind==="suggested"?" · Suggested leg only":""}</span></button>;
 return <section aria-label="Leg timeline" className="grid min-w-0 gap-4 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
  <header><h2 className="text-xl font-bold">Leg timeline</h2><p className="text-sm text-slate-600">{season} · Tap a stop to see its position on the map and the events around it. Scroll sideways through the season.</p>
   <p className="mt-2 text-xs text-slate-600">Solid: confirmed · Dashed: proposed · ⚠ Red outline: overlapping recorded windows. Bars include recorded reserved days. Blank space is not verified availability.</p>
  </header>
  <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">Timeline zoom<select value={month??""} onChange={e=>setMonth(e.target.value===""?null:Number(e.target.value))}><option value="">Whole season</option>{Array.from({length:12},(_,i)=><option key={i} value={i}>{new Date(Date.UTC(season,i,1)).toLocaleString("en-US",{month:"long",timeZone:"UTC"})}</option>)}</select></label>
  <div className="max-w-full overflow-x-auto rounded-lg border" tabIndex={0} aria-label="Season timeline, scroll horizontally">
   <div className="min-w-[1200px]">
    <div className="flex border-b bg-slate-50"><div className="sticky left-0 z-10 w-32 shrink-0 bg-slate-50 p-2 font-semibold">Leg / {season}</div><div className="flex flex-1">{(month===null?Array.from({length:12},(_,i)=>i):[month]).map(i=><span key={i} style={{width:month===null?((Date.UTC(season,i+1,1)-Date.UTC(season,i,1))/(Date.UTC(season+1,0,1)-Date.UTC(season,0,1))*100)+"%":"100%"}} className="border-l p-2 text-xs font-bold">{new Date(Date.UTC(season,i,1)).toLocaleString("en-US",{month:"short",timeZone:"UTC"})}</span>)}</div></div>
    {rows.map(({leg,bars,height})=><div key={leg.id} className="flex border-b last:border-0" style={{minHeight:height}}>
     <div className="sticky left-0 z-10 w-32 shrink-0 border-r bg-white p-2 text-sm font-bold" style={{borderLeft:"5px solid "+leg.color}}>{leg.name}{!bars.length?<p className="mt-1 text-xs font-normal">No dated stops in view</p>:null}</div>
     <div className="relative flex-1 bg-slate-50/50" style={{height}}>
      {bars.map(({event,window,placement,lane,overlaps})=><button key={event.id} type="button" aria-label={"Inspect "+event.name} aria-pressed={selectedId===event.id}
       title={event.name+" · "+window.startLabel+" – "+window.endLabel+" · "+label(event)}
       className={"absolute min-h-11 min-w-11 overflow-hidden rounded-md border-2 px-1 text-left text-xs "+(bucket(event)==="confirmed"?"bg-slate-100":"border-dashed bg-amber-50")+(selectedId===event.id?" ring-2 ring-orange-600":"")}
       style={{left:placement.left+"%",width:placement.width+"%",top:lane*58+6,borderColor:overlaps.length?"#be123c":leg.color}}
       onClick={()=>inspect(event)}><span className="block truncate font-bold">{overlaps.length?"⚠ ":""}{event.name}</span><span className="block truncate">{window.startLabel.slice(5)}–{window.endLabel.slice(5)}</span></button>)}
     </div>
    </div>)}
   </div>
  </div>
  <div className="grid gap-3 lg:grid-cols-2">
   <section aria-label="Needs a leg" className="grid content-start gap-2"><h3 className="font-bold">Needs a leg</h3><p className="text-xs text-slate-600">Unassigned bookings and suggestions remain visible while you compare routes.</p>{unassigned.length?<div className="grid max-h-64 gap-2 overflow-y-auto">{unassigned.map(eventButton)}</div>:<p className="text-sm text-slate-500">No unassigned bookings in this view.</p>}</section>
   {invalid.length?<section aria-label="Dates need review" className="grid content-start gap-2 rounded-lg bg-amber-50 p-3"><h3 className="font-bold">Dates need review</h3><p className="text-xs">Missing, incomplete or conflicting dates are not drawn as route availability.</p><div className="grid max-h-64 gap-2 overflow-y-auto">{invalid.map(eventButton)}</div></section>:null}
  </div>
  {selected&&context?<section aria-label="Selected stop" className="grid gap-2 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
   <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{selected.name}</h3><span className="text-sm font-semibold">{label(selected)} · {selected.travelLegAssignmentKind==="suggested"?"Suggested: ":""}{selected.travelLegName??"Unassigned"}</span></div>
   <p className="text-sm">{timelineWindow(selected) ? "Recorded window: "+timelineWindow(selected)!.startLabel+" – "+timelineWindow(selected)!.endLabel : "Dates need review"}</p>
   <p className="text-sm">{[selected.city,selected.region].filter(Boolean).join(", ")||"Location not recorded"}</p>
   <label className="grid max-w-sm gap-1 text-sm font-semibold">Compare with leg (preview only)<select value={selectedLeg??""} onChange={e=>onPreviewLeg(e.target.value||null)}><option value="">Choose a leg</option>{legs.filter(l=>!l.archivedAt).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <p className="text-xs">Preview does not assign a leg, reserve equipment or approve a split.</p>
   <p className="text-sm">Before: {context.before?.name??"No earlier dated stop recorded"}{context.daysBefore!==null?" · "+context.daysBefore+" clear calendar days":""}</p>
   <p className="text-sm">After: {context.after?.name??"No later dated stop recorded"}{context.daysAfter!==null?" · "+context.daysAfter+" clear calendar days":""}</p>
   {context.overlaps.length?<p role="status" className="text-sm font-bold text-rose-800">Recorded window overlaps: {context.overlaps.map(e=>e.name).join(", ")}</p>:null}
   {context.unknown.length?<p className="text-sm text-amber-900">{context.unknown.length} other stops on this leg need date review.</p>:null}
   {!timelineWindow(selected)?.reserved?<p className="text-sm text-amber-900">Setup and teardown window not recorded or needs review.</p>:null}
   <p className="text-sm">Comparison travel time is unknown. Saved estimates apply only to the stops and leg in their recorded plan.</p>
   {selected.legAssignmentWarning?<p className="text-sm font-bold text-amber-900">{selected.legAssignmentWarning.replaceAll("_"," ")}: {selected.legAssignmentExplanation}</p>:null}
   {renderSelectedDetails?<><button type="button" className="button-secondary w-fit" onClick={()=>setExpandedDetails(expandedDetails===selected.id?null:selected.id)}>{expandedDetails===selected.id?"Hide":"Show"} packages &amp; saved route details</button>{expandedDetails===selected.id?renderSelectedDetails(selected.id):null}</>:null}
   <Link className="min-h-11 w-fit rounded-lg border bg-white px-3 py-2 text-sm font-bold" href={operationsScheduleHref({season,bookingId:selected.id,legId:selected.travelLegId}).replace("/schedule",profileBasePath==="/boss/profiles"?"/boss/schedule":"/schedule")}>Review packages, crew &amp; operating plan</Link>
  </section>:<p className="text-sm text-slate-500">Select a stop above or on the map to inspect its route fit.</p>}
 </section>;
}
