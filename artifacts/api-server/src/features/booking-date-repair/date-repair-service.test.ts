import { expect,it } from "vitest";
import { repairProposalSchema } from "./date-repair-dto";
import { proposal } from "./date-repair-test-setup";
it("rejects actor or revision fabrication and ambiguous endpoint selection",()=>{
 expect(repairProposalSchema.safeParse({...proposal(),actorId:"owner"}).success).toBe(false);
 const p=proposal();p.endpoints[0].sourceRef={...p.endpoints[0].sourceRef,revision:"fabricated"} as never;
 expect(repairProposalSchema.safeParse(p).success).toBe(false);
 expect(repairProposalSchema.safeParse({...proposal(),endpoints:[proposal().endpoints[0],proposal().endpoints[0]]}).success).toBe(false);
 expect(repairProposalSchema.safeParse({...proposal(),endpoints:[],clearFields:[]}).success).toBe(false);
});
