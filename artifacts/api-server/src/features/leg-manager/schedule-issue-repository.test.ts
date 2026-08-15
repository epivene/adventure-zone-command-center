import { describe, expect, it } from "vitest";
import { createScheduleIssue, type ScheduleIssueStore } from "./schedule-issue-repository";
const A="00000000-0000-4000-8000-000000000001", B="00000000-0000-4000-8000-000000000002", M="00000000-0000-4000-8000-000000000099";
class Store implements ScheduleIssueStore {
  rows:any[]=[]; bookingLeg=new Map([["ba",A],["bb",B]]); tripLeg=new Map([["ta",A],["tb",B]]);
  async findByMutation(legId:string,id:string){return this.rows.find(x=>x.legId===legId&&x.clientMutationId===id)??null}
  async bookingBelongsToLeg(id:string,legId:string){return this.bookingLeg.get(id)===legId}
  async tripBelongsToLeg(id:string,legId:string){return this.tripLeg.get(id)===legId}
  async insert(i:any){const row={id:`i${this.rows.length+1}`,status:"open",...i};this.rows.push(row);return row}
}
describe("schedule issue creation",()=>{
  it("returns the existing issue on a retry without inserting twice",async()=>{const s=new Store();const input={legId:A,bookingId:"ba",tripId:null,kind:"wrong_datetime" as const,notes:"Wrong time",clientMutationId:M};const one=await createScheduleIssue(s,input);const two=await createScheduleIssue(s,input);expect(one).toMatchObject({ok:true,idempotent:false});expect(two).toMatchObject({ok:true,idempotent:true});expect(two.issue).toEqual(one.issue);expect(s.rows).toHaveLength(1)});
  it("rejects cross-leg booking references",async()=>{const s=new Store();await expect(createScheduleIssue(s,{legId:A,bookingId:"bb",tripId:null,kind:"wrong_leg",notes:"Wrong leg",clientMutationId:M})).resolves.toMatchObject({ok:false,code:"CROSS_LEG_REFERENCE"});expect(s.rows).toHaveLength(0)});
});
