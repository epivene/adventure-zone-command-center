import { describe, expect, it } from "vitest";
import { normalizeOpportunity } from "./opportunity-normalizer";
describe("ACT opportunity date provenance", () => {
  it("keeps close dates as labeled sales milestones without public endpoints", () => {
    const result = normalizeOpportunity({ name:"Fair", city:"Denver", state:"CO", status:"confirmed", estimatedCloseDate:"2026-04-01T12:00:00Z", actualCloseDate:"9999-12-31T00:00:00Z" });
    expect(result).toMatchObject({ok:true,value:{startsAt:null,endsAt:null,localStatus:"confirmed",salesMilestones:{estimatedCloseDate:"2026-04-01T12:00:00Z",actualCloseDate:"9999-12-31T00:00:00Z"}}});
  });
  it("preserves malformed sales source values while flagging review", () => {
    expect(normalizeOpportunity({name:"Fair",city:"Denver",state:"CO",estimatedCloseDate:"2026-02-30T00:00:00Z"})).toMatchObject({
      ok:true,value:{startsAt:null,endsAt:null,salesMilestones:{estimatedCloseDate:"2026-02-30T00:00:00Z",actualCloseDate:null}},
      warnings:["malformed_opportunity_date"],
    });
  });
});
