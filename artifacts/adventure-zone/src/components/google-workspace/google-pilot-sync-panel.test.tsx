import { render,screen,fireEvent,waitFor,cleanup } from "@testing-library/react";
import { it,expect,vi,afterEach } from "vitest";
import { GooglePilotSyncPanel } from "./google-pilot-sync-panel";
const data=vi.hoisted(()=>({error:false}));
vi.mock("@/lib/auth-token",()=>({apiFetch:async()=>({ok:true,json:async()=>({items:[{profileId:"one",profileName:"Strawberry Days",threadId:"thread",checkedAt:"2026-10-16T20:00:00Z",errorCode:data.error?"PILOT_SYNC_FAILED":null,snapshot:{state:"draft_to_review",drafts:[{id:"d",bodyText:"Owner's current draft"}]},ownerDecision:"Confirm space first",followups:[{id:"f",kind:"Review proposal",dueAt:"2026-10-15T17:00:00Z"}]}]})})}));
afterEach(()=>{cleanup();data.error=false;});
it("shows the current draft alongside preserved decision and follow-up",async()=>{
 render(<GooglePilotSyncPanel/>);
 expect(await screen.findByText("Draft to review")).toBeTruthy();
 expect(screen.getByText("Confirm space first")).toBeTruthy();
 expect(screen.getByText(/Review proposal/)).toBeTruthy();
 expect(screen.getByText("Owner's current draft")).toBeTruthy();
 data.error=true;fireEvent.click(screen.getByRole("button",{name:"Check now"}));
 await waitFor(()=>expect(screen.getByText(/Sync needs attention/)).toBeTruthy());
 expect(screen.getByText("Owner's current draft")).toBeTruthy();
});
