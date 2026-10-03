import { describe, expect, it } from "vitest";
import { timelineWindow, stopContext, timelinePlacement } from "./leg-timeline";
import type { MapEvent } from "./map-data";
const event = (id:string,start:string,end:string,extra:Partial<MapEvent>={}):MapEvent => ({
 id,name:id,city:"",region:"",latitude:null,longitude:null,status:"confirmed",probability:"definite",
 travelLegId:"a",travelLegName:"Angel",travelLegColor:"#123456",dateOnly:true,
 startsAt:new Date(start),endsAt:new Date(end),...extra
});
describe("leg timeline date evidence",()=>{
 it("preserves exclusive reserved ends and includes setup days",()=>{
  const w=timelineWindow(event("one","2027-07-04","2027-07-04",{reservedStartsAt:new Date("2027-07-02"),reservedEndsAt:new Date("2027-07-06"),reservedDateOnly:true,reservedEndExclusive:true}));
  expect(w?.startLabel).toBe("2027-07-02");expect(w?.endLabel).toBe("2027-07-05");
  expect(w?.reserved).toBe(true);
 });
 it("does not draw sentinel, reversed, or incomplete dates",()=>{
  expect(timelineWindow(event("sentinel","2027-07-04","9999-12-31"))).toBeNull();
  expect(timelineWindow(event("reverse","2027-07-05","2027-07-04"))).toBeNull();
  expect(timelineWindow(event("partial","2027-07-04","2027-07-04",{endsAt:null}))).toBeNull();
 });
 it("finds all overlaps, including a long booking around intervening short stops",()=>{
  const long=event("long","2027-07-01","2027-07-20"),short=event("short","2027-07-02","2027-07-03"),target=event("target","2027-07-10","2027-07-11");
  expect(stopContext([long,short,target],target,"a").overlaps.map(x=>x.id)).toEqual(["long"]);
 });
 it("compares an unassigned candidate without modifying its leg",()=>{
  const candidate=event("candidate","2027-07-10","2027-07-11",{travelLegId:null});
  const context=stopContext([event("before","2027-07-01","2027-07-05"),candidate,event("after","2027-07-15","2027-07-16")],candidate,"a");
  expect(context.before?.id).toBe("before");expect(context.after?.id).toBe("after");
  expect(context.daysBefore).toBe(4);expect(context.daysAfter).toBe(3);expect(candidate.travelLegId).toBeNull();
 });
 it("clips a cross-year reserved block to the selected year",()=>{
  const w=timelineWindow(event("cross","2026-12-30","2027-01-03"))!;
  expect(timelinePlacement(w,2027)).toEqual({left:0,width:3/365*100});
 });
});
