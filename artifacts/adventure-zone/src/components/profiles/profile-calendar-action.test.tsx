// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileCalendarAction } from "./profile-calendar-action";
import type { CalendarPreview } from "@/features/google-workspace/profile-calendar-preview-client";
vi.mock("@/lib/auth-token",()=>({apiFetch:vi.fn()}));
afterEach(cleanup);
function preview(id="p1"): CalendarPreview {
  return {id,fingerprint:"fingerprint",expiresAt:"2027-07-01",calendarId:"operations",
    facts:{name:"Fair",venue:"Fairgrounds",startsOn:"2027-07-21",endsOn:"2027-07-26",setupOn:null,teardownOn:null,
      packages:[{key:"zone",name:"Zone"}],sources:[]},
    setupOn:"2027-07-19",teardownOn:"2027-07-27",problems:[],
    events:[{eventId:"stable",packageKey:"zone",mode:"create",input:{summary:"Fair (Zone)",description:"EVENT DATES: July 21–26",startDate:"2027-07-19",endDateExclusive:"2027-07-28"}}]};
}
async function open(client: any) {
  render(<ProfileCalendarAction profileId="profile" bookings={[{id:"booking",name:"Fair"}]} client={client}/>);
  fireEvent.click(screen.getByRole("button",{name:"Add to calendar"}));
  fireEvent.change(screen.getByLabelText("Calendar booking"),{target:{value:"booking"}});
  fireEvent.click(screen.getByRole("button",{name:"Load saved booking"}));
  await screen.findByText("Fairgrounds");
}
describe("profile calendar review",()=>{
  it("requires reviewed server preview after editing and sends its exact identity",async()=>{
    const client={preview:vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview("p2")),
      apply:vi.fn().mockResolvedValue({state:"saved",previewId:"p2",savedAt:"now",events:[{id:"stable",packageKey:"zone",href:"https://calendar.google.com/"}]})};
    await open(client);
    fireEvent.click(screen.getByRole("button",{name:"Two days before"}));
    fireEvent.click(screen.getByRole("button",{name:"One day after"}));
    expect(screen.queryByRole("button",{name:"Save reviewed calendar entries"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Refresh preview"}));
    await waitFor(()=>expect(client.preview).toHaveBeenLastCalledWith({profileId:"profile",bookingId:"booking",setupOn:"2027-07-19",teardownOn:"2027-07-27"}));
    const save=await screen.findByRole("button",{name:"Save reviewed calendar entries"});
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(save);
    await screen.findByText("Calendar entries saved and verified.");
    expect(client.apply).toHaveBeenCalledWith({previewId:"p2",fingerprint:"fingerprint"});
  });
  it("shows unresolved evidence and offers no save",async()=>{
    const client={preview:vi.fn().mockResolvedValue({...preview(),problems:["Date evidence changed."]}),apply:vi.fn()};
    await open(client);
    expect(screen.getByText("Date evidence changed.")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Save reviewed calendar entries"})).toBeNull();
    expect(client.apply).not.toHaveBeenCalled();
  });
  it("retains the same preview after an uncertain response",async()=>{
    const client={preview:vi.fn().mockResolvedValue(preview()),apply:vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(
      {state:"saved",previewId:"p1",savedAt:"now",events:[{id:"stable",packageKey:"zone",href:"https://calendar.google.com/"}]})};
    await open(client);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button",{name:"Save reviewed calendar entries"}));
    fireEvent.click(await screen.findByRole("button",{name:"Retry save verification"}));
    await screen.findByText("Calendar entries saved and verified.");
    expect(client.apply.mock.calls).toEqual([[{previewId:"p1",fingerprint:"fingerprint"}],[{previewId:"p1",fingerprint:"fingerprint"}]]);
    expect(client.preview).toHaveBeenCalledTimes(1);
  });
});
