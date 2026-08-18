import { describe, expect, it } from "vitest";
import { ManagerAssistantService } from "./manager-assistant-service";

const source = {
  async getLeg() { return { id:"leg-a", name:"Leg A" }; },
  async listAssignedEvents() { return [{id:"booking-a",name:"Fair A",city:"Town",region:"ND",startsAt:"2026-08-20T00:00:00.000Z",endsAt:null,status:"confirmed",packageNames:["Adventure Zone"],resourceNames:[],setupSummary:null}]; },
  async getRoute() { return null; },
  async listHandoffs() { return []; },
  async listAcknowledgments() { return []; },
  async listOperationalInstructions() { return []; },
  async listKnowledge() { return [{id:"knowledge-a",title:"Arrival process",body:"Call the site contact before unloading."}]; },
};

const request = { authenticatedLegId:"leg-a", request:{contextKind:"booking" as const,contextRecordId:"booking-a",question:"How should I handle arrival?"} };

describe("ManagerAssistantService",()=>{
  it("accepts a cloud answer only when it cites manager-safe source ids",async()=>{
    const service=new ManagerAssistantService(source,async()=>({providerName:"fake",complete:async()=>JSON.stringify({text:"Call the site contact before unloading.",confidence:"high",sourceIds:["manager_knowledge_knowledge-a"],needsAdmin:false})}));
    const result=await service.ask(request);
    expect(result?.answer.mode).toBe("cloud");
    expect(result?.answer.needsAdmin).toBe(false);
    expect(result?.answer.sources[0]?.recordId).toBe("knowledge-a");
  });

  it("rejects cloud citations outside the scoped source bundle",async()=>{
    const service=new ManagerAssistantService(source,async()=>({providerName:"fake",complete:async()=>JSON.stringify({text:"Secret instruction",confidence:"high",sourceIds:["other-leg-secret"],needsAdmin:false})}));
    const result=await service.ask(request);
    expect(result?.answer.needsAdmin).toBe(true);
    expect(result?.answer.sources).toEqual([]);
  });

  it("falls back to Ask Admin when the provider fails",async()=>{
    const service=new ManagerAssistantService(source,async()=>{throw new Error("provider down");});
    const result=await service.ask(request);
    expect(result?.answer.needsAdmin).toBe(true);
    expect(result?.answer.mode).toBe("deterministic");
  });
});
