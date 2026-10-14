// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const api=vi.hoisted(()=>({apiGet:vi.fn(),apiPost:vi.fn(),apiPut:vi.fn()}));
vi.mock("@/lib/auth-token",()=>api);
import { ProfileDeadlines, RemindersPage, RemindersProvider, ReminderBell, UpcomingDeadlines } from "./reminders";
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("shows Not set and saves reminder offsets on the existing application field",async()=>{
  api.apiGet.mockResolvedValue({items:[{sourceKey:"application:p",organizationId:"p",profileName:"Blanding",kind:"application",label:"Application deadline",dueOn:null,offsets:null,completed:false,editable:true}]});
  api.apiPut.mockResolvedValue({ok:true});
  render(<ProfileDeadlines profileId="p"/>);
  await screen.findByText("Application deadline: Not set");
  fireEvent.click(screen.getByText("Dates & deadline reminders"));
  expect(screen.getByLabelText("Remind me this many days before").getAttribute("value")).toBe("14, 7");
  const user=userEvent.setup();
  await user.click(screen.getByLabelText("Remind me this many days before"));
  await user.keyboard("{Control>}a{/Control}{Backspace}");
  await user.type(screen.getByLabelText("Remind me this many days before"),"30, 14, 7");
  fireEvent.click(screen.getByRole("button",{name:"Save reminder"}));
  await waitFor(()=>expect(api.apiPut).toHaveBeenCalledWith("/deadline-rules/profiles/p/item",expect.objectContaining({sourceKey:"application:p",offsets:[30,14,7],dueOn:null})));
});
it("evaluates on load and shows linked upcoming items and the badge",async()=>{
  api.apiPost.mockResolvedValue({});
  api.apiGet.mockResolvedValue({upcoming:[{sourceKey:"vendor:p",organizationId:"p",profileName:"Blanding",label:"Vendor deadline",dueOn:"2026-10-20"}],notifications:[],count:2,lastEvaluatedAt:null});
  render(<RemindersProvider><ReminderBell/><UpcomingDeadlines/></RemindersProvider>);
  await screen.findByRole("link",{name:"Reminders, 2 active"});
  expect(screen.getByRole("link",{name:"Blanding"}).getAttribute("href")).toBe("/profiles/p");
  expect(api.apiPost).toHaveBeenCalledWith("/deadline-rules/evaluate",{});
});
it("toggles a rule without needing code and marks email setup off",async()=>{
  const rule={id:"rule",name:"Upcoming",enabled:true,trigger:{type:"deadline_before",days:[14,7],useItemOffsets:true},actions:["notify","badge"]};
  api.apiGet.mockResolvedValue({rules:[rule],email:{enabled:false,providerConfigured:false}});
  api.apiPut.mockResolvedValue({});
  render(<RemindersPage/>);
  await screen.findByDisplayValue("Upcoming");
  fireEvent.click(screen.getAllByLabelText("On")[0]);
  await waitFor(()=>expect(api.apiPut).toHaveBeenCalledWith("/deadline-rules/rule",expect.objectContaining({enabled:false})));
  expect(screen.getByText(/Off \(default\)/)).toBeTruthy();
});
