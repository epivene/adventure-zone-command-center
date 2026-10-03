import type { MapEvent } from "./map-data";
import { operationsDateKey } from "@/features/bookings/operations-navigation";
const DAY = 86400000;
export type TimelineWindow = {start:number;end:number;startLabel:string;endLabel:string;reserved:boolean};
function dateKey(value:Date|null|undefined,dateOnly=false,exclusive=false):string|null {
 if(!value || !Number.isFinite(value.getTime()) || value.getUTCFullYear()>=9999) return null;
 const d=new Date(value.getTime()-(exclusive?(dateOnly?DAY:1):0));
 return operationsDateKey(d,dateOnly);
}
const ordinal=(key:string)=>Date.parse(key+"T00:00:00Z")/DAY;
/** Day cells describe recorded occupancy, never driving feasibility. */
export function timelineWindow(event:MapEvent):TimelineWindow|null {
 const a=dateKey(event.startsAt,event.dateOnly),b=dateKey(event.endsAt,event.dateOnly);
 if(!a||!b||b<a) return null;
 const hasReservation=!!(event.reservedStartsAt||event.reservedEndsAt);
 const r1=dateKey(event.reservedStartsAt,event.reservedDateOnly);
 const r2=dateKey(event.reservedEndsAt,event.reservedDateOnly,event.reservedEndExclusive);
 if(hasReservation&&(!r1||!r2||r2<r1)) return null;
 const startLabel=r1&&r1<a?r1:a,endLabel=r2&&r2>b?r2:b;
 return {start:ordinal(startLabel),end:ordinal(endLabel),startLabel,endLabel,reserved:hasReservation};
}
export function timelinePlacement(window:TimelineWindow,year:number){
 const start=ordinal(year+"-01-01"),end=ordinal((year+1)+"-01-01");
 const a=Math.max(start,window.start),b=Math.min(end,window.end+1);
 return b<=a?null:{left:(a-start)/(end-start)*100,width:(b-a)/(end-start)*100};
}
export function stopContext(events:MapEvent[],selected:MapEvent,legId:string|null) {
 const window=timelineWindow(selected);
 const others=events.filter(e=>e.id!==selected.id&&e.travelLegId===legId&&legId!==null)
  .map(event=>({event,window:timelineWindow(event)})).filter(x=>x.window!==null)
  .sort((a,b)=>a.window!.start-b.window!.start||a.event.id.localeCompare(b.event.id));
 const before=window?others.filter(x=>x.window!.end<window.start).sort((a,b)=>b.window!.end-a.window!.end)[0]:undefined;
 const after=window?others.find(x=>x.window!.start>window.end):undefined;
 return {before:before?.event??null,after:after?.event??null,
 daysBefore:before&&window?window.start-before.window!.end-1:null,
 daysAfter:after&&window?after.window!.start-window.end-1:null,
 overlaps:window?others.filter(x=>x.window!.start<=window.end&&x.window!.end>=window.start).map(x=>x.event):[],
 unknown:events.filter(e=>e.id!==selected.id&&e.travelLegId===legId&&!timelineWindow(e))};
}
