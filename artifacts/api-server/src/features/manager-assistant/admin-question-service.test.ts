import { describe, expect, it } from "vitest";

import { AdminQuestionService } from "./admin-question-service";

const source = {
  async getLeg() { return { id: "leg-a", name: "Leg A" }; },
  async listAssignedEvents() { return [{ id:"booking-a",name:"Fair A",city:null,region:null,startsAt:null,endsAt:null,status:"confirmed",packageNames:[],resourceNames:[],setupSummary:null }]; },
  async getRoute() { return { tripId:"trip-a",label:"Route A",startDate:null,endDate:null,stops:[{bookingId:"booking-a",label:"Fair A",sortOrder:1}] }; },
  async listHandoffs() { return []; },
  async listAcknowledgments() { return []; },
  async listOperationalInstructions() { return []; },
  async listKnowledge() { return []; },
};

class Store {
  created:any[]=[];
  async findByClientMutationId(){ return null; }
  async insert(input:any){ this.created.push(input); return { id:"q1", status:"needs_answer", ...input }; }
}

describe("AdminQuestionService", () => {
  it("refuses escalation for a booking outside the authenticated leg", async () => {
    const store = new Store();
    const service = new AdminQuestionService({ source, store });
    const result = await service.create({
      authenticatedLegId:"leg-a",
      managerSessionSubject:"manager:leg-a",
      contextKind:"booking",
      contextRecordId:"booking-b",
      clientMutationId:"11111111-1111-4111-8111-111111111111",
      question:"Do we need a forklift?",
      urgency:"normal",
      escalationReason:"No answer found.",
    });
    expect(result).toEqual({ ok:false, code:"OUTSIDE_LEG" });
    expect(store.created).toHaveLength(0);
  });

  it("stores only the scoped context for an authorized booking", async () => {
    const store = new Store();
    const service = new AdminQuestionService({ source, store });
    const result = await service.create({
      authenticatedLegId:"leg-a",
      managerSessionSubject:"manager:leg-a",
      contextKind:"booking",
      contextRecordId:"booking-a",
      clientMutationId:"11111111-1111-4111-8111-111111111111",
      question:"Do we need a forklift?",
      urgency:"normal",
      escalationReason:"No answer found.",
    });
    expect(result.ok).toBe(true);
    expect(store.created[0]?.travelLegId).toBe("leg-a");
    expect(store.created[0]?.bookingId).toBe("booking-a");
  });
});
