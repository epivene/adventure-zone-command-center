import { describe, expect, it } from "vitest";

import { managerAssistantCacheKey, pruneManagerAssistantSnapshots } from "./manager-assistant-offline-cache";

function row(index:number, savedAt:string){return {key:`leg-a:booking:${index}`,legId:"leg-a",contextKind:"booking" as const,contextRecordId:String(index),savedAt,context:{leg:{id:"leg-a",name:"Leg A"},activeContext:{kind:"booking" as const,recordId:String(index),label:`Event ${index}`},assignedEvents:[],activeEvent:null,route:null,handoffs:[],acknowledgments:[],operationalInstructions:[],knowledge:[],generatedAt:savedAt}};}

describe("manager assistant offline cache",()=>{
  it("keys cached context by leg and record",()=>{
    expect(managerAssistantCacheKey("leg-a",{kind:"booking",recordId:"b1"})).toBe("leg-a:booking:b1");
    expect(managerAssistantCacheKey("leg-b",{kind:"booking",recordId:"b1"})).not.toBe("leg-a:booking:b1");
  });
  it("keeps only recent bounded snapshots",()=>{
    const rows=Array.from({length:25},(_,i)=>row(i,new Date(Date.UTC(2026,7,i+1)).toISOString()));
    const kept=pruneManagerAssistantSnapshots(rows,{now:new Date("2026-08-26T00:00:00.000Z"),maxEntries:20,maxAgeDays:30});
    expect(kept).toHaveLength(20);
    expect(kept[0]?.contextRecordId).toBe("24");
  });
  it("drops another leg when clearing one leg scope",()=>{
    const rows=[row(1,"2026-08-17T00:00:00.000Z"),{...row(2,"2026-08-17T00:00:00.000Z"),key:"leg-b:booking:2",legId:"leg-b"}];
    expect(rows.filter(item=>item.legId!=="leg-a").map(item=>item.legId)).toEqual(["leg-b"]);
  });
});
