import { beforeEach, describe, expect, it } from "vitest";
import { issueLegManagerToken } from "./leg-manager-auth";
import { resolveLegManagerSession, type LegManagerSessionRepository } from "./leg-manager-middleware";
const A="00000000-0000-4000-8000-000000000001", B="00000000-0000-4000-8000-000000000002";
class Repo implements LegManagerSessionRepository {
  records=new Map<string,{legId:string;managerName:string|null;sessionVersion:number}>();
  async getActiveAccess(id:string){return this.records.get(id)??null;}
}
beforeEach(()=>{process.env.SESSION_SECRET="task-three-test-secret";});
describe("resolveLegManagerSession",()=>{
  it("accepts exact active leg/version",async()=>{const r=new Repo();r.records.set(A,{legId:A,managerName:"Alice",sessionVersion:4});const t=issueLegManagerToken({legId:A,sessionVersion:4})!.token;await expect(resolveLegManagerSession(t,r)).resolves.toEqual({legId:A,managerName:"Alice",sessionVersion:4});});
  it("rejects stale versions",async()=>{const r=new Repo();r.records.set(A,{legId:A,managerName:null,sessionVersion:5});const t=issueLegManagerToken({legId:A,sessionVersion:4})!.token;await expect(resolveLegManagerSession(t,r)).resolves.toBeNull();});
  it("cannot use another leg token",async()=>{const r=new Repo();r.records.set(A,{legId:A,managerName:"A",sessionVersion:1});const t=issueLegManagerToken({legId:B,sessionVersion:1})!.token;await expect(resolveLegManagerSession(t,r)).resolves.toBeNull();});
  it("rejects archived/disabled access",async()=>{const r=new Repo();const t=issueLegManagerToken({legId:A,sessionVersion:1})!.token;await expect(resolveLegManagerSession(t,r)).resolves.toBeNull();});
});
