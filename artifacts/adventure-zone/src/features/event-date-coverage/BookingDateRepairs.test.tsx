import { render,screen,fireEvent,waitFor,cleanup } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
import { BookingDateRepairs } from "./BookingDateRepairs";
import * as api from "./booking-date-repairs-api";
vi.mock("./booking-date-repairs-api",()=>({getDateRepairs:vi.fn(),previewDateRepair:vi.fn(),applyDateRepair:vi.fn()}));
const dates={rawPublic:{start:"2026-01-01T00:00:00.000Z",end:"9999-12-31T00:00:00.000Z"},rawReservation:{start:null,end:null},publicWindow:null,reservationWindow:null,publicEndExclusive:false,reservationEndExclusive:false,evidenceState:"needs_review",reviewReasons:["INCOMPLETE_PUBLIC_WINDOW"],endpointEvidence:[]};
const a={bookingId:"booking-a",profileId:"same-profile",name:"Fair",season:"2027",status:"lead",packages:[{package_template_id:"pirates"}],assignments:[],dateProvenance:dates,sources:[{type:"saved_note",id:"note-a",revision:"server-revision",label:"Saved 2027 agreement",content:"2027-07-21 through 2027-07-26"}]};
const b={...a,bookingId:"booking-b",season:"2028",packages:[{package_template_id:"zone"}],sources:[{...a.sources[0],id:"note-b",label:"Saved 2028 agreement"}]};
const preview={id:"preview-a",bookingId:a.bookingId,fingerprint:"fingerprint",expiresAt:"2030-01-01",before:{rawPublic:dates.rawPublic,rawReservation:dates.rawReservation,evidence:[]},after:{rawPublic:{start:"2027-07-21T06:00:00.000Z",end:"2027-07-27T05:59:59.999Z"},rawReservation:dates.rawReservation,evidence:[{field:"public_start",kind:"verified_event",value:"2027-07-21",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:"note-a",revision:"server-revision"}}]},impacts:{blocked:false,reasons:[],affectedBookingIds:[a.bookingId]},afterResolved:{...dates,publicWindow:{start:"2027-07-21T06:00:00.000Z",end:"2027-07-27T05:59:59.999Z"}}};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.getDateRepairs).mockResolvedValue({records:[a,b],nextCursor:null} as never);vi.mocked(api.previewDateRepair).mockResolvedValue(preview as never);vi.mocked(api.applyDateRepair).mockResolvedValue({id:"receipt",bookingId:a.bookingId} as never);});
afterEach(cleanup);
const setup=()=>{const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><BookingDateRepairs/></QueryClientProvider>);return client;};
const choose=async(id=a.bookingId)=>{await screen.findByRole("option",{name:new RegExp(id)});fireEvent.change(screen.getByLabelText("Exact booking"),{target:{value:id}});};
const fill=()=>{
 fireEvent.change(screen.getByLabelText("Source for public_start"),{target:{value:"saved_note:note-a"}});
 fireEvent.change(screen.getByLabelText("Source for public_end"),{target:{value:"saved_note:note-a"}});
 fireEvent.change(screen.getByLabelText("Classification for public_start"),{target:{value:"verified_event"}});
 fireEvent.change(screen.getByLabelText("Classification for public_end"),{target:{value:"verified_event"}});
 fireEvent.change(screen.getByLabelText("Value for public_start"),{target:{value:"2027-07-21"}});
 fireEvent.change(screen.getByLabelText("Value for public_end"),{target:{value:"2027-07-26"}});
 fireEvent.change(screen.getByLabelText("Semantics for public_start"),{target:{value:"inclusive_date"}});
 fireEvent.change(screen.getByLabelText("Semantics for public_end"),{target:{value:"inclusive_date"}});
 fireEvent.change(screen.getByLabelText("Repair reason"),{target:{value:"Checked exact 2027 saved agreement"}});
};
it("requires an exact booking and displays season/package/profile/source identity without auto-apply",async()=>{
 setup();await choose();
 expect(screen.getByRole("option",{name:/booking-a/})).toHaveTextContent(/2027.*pirates.*same-profile/);
 expect(screen.getByRole("option",{name:/booking-b/})).toHaveTextContent(/2028.*zone.*same-profile/);
 expect(screen.getAllByText("Saved 2027 agreement").length).toBeGreaterThan(0);
 expect(screen.getByRole("link",{name:"Create a separate season booking"})).toHaveAttribute("href",expect.stringContaining("same-profile"));
 expect(api.applyDateRepair).not.toHaveBeenCalled();
});
it("shows before/after semantics and impacts, only applies on explicit click and refreshes connected queries",async()=>{
 const client=setup(),invalidate=vi.spyOn(client,"invalidateQueries");await choose();fill();fireEvent.click(screen.getByRole("button",{name:"Preview repair"}));
 await screen.findByRole("heading",{name:"Repair preview"});
 expect(screen.getAllByText(/9999-12-31/).length).toBeGreaterThan(0);expect(screen.getAllByText(/inclusive_date/).length).toBeGreaterThan(0);
 expect(api.applyDateRepair).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Apply reviewed repair"}));
 await waitFor(()=>expect(api.applyDateRepair).toHaveBeenCalledOnce());
 await waitFor(()=>expect(invalidate).toHaveBeenCalled());
});
it("blocks apply for a blocked preview",async()=>{
 vi.mocked(api.previewDateRepair).mockResolvedValue({...preview,impacts:{...preview.impacts,blocked:true,reasons:["RECONCILE_EXISTING_COMMITMENTS_FIRST"]}} as never);
 setup();await choose();fill();fireEvent.click(screen.getByRole("button",{name:"Preview repair"}));
 await screen.findByRole("heading",{name:"Repair preview"});
 expect(screen.getByRole("button",{name:"Apply reviewed repair"})).toBeDisabled();
 expect(screen.getByText("RECONCILE_EXISTING_COMMITMENTS_FIRST")).toBeInTheDocument();
});
it("keeps the draft after 409 and requires refreshed preview",async()=>{
 vi.mocked(api.applyDateRepair).mockRejectedValue(Object.assign(new Error("PREVIEW_STALE"),{status:409}));
 setup();await choose();fill();fireEvent.click(screen.getByRole("button",{name:"Preview repair"}));await screen.findByRole("heading",{name:"Repair preview"});
 fireEvent.click(screen.getByRole("button",{name:"Apply reviewed repair"}));await screen.findByText(/Create a fresh preview/);
 expect(screen.getByLabelText("Value for public_start")).toHaveValue("2027-07-21");
 expect(screen.getByLabelText("Repair reason")).toHaveValue("Checked exact 2027 saved agreement");
 expect(screen.queryByRole("button",{name:"Apply reviewed repair"})).not.toBeInTheDocument();
});
it("ignores a late preview from an earlier selection and retains per-booking drafts",async()=>{
 let resolve!:(value:unknown)=>void;vi.mocked(api.previewDateRepair).mockImplementation(()=>new Promise(r=>{resolve=r;}) as never);
 setup();await choose();fill();fireEvent.click(screen.getByRole("button",{name:"Preview repair"}));await waitFor(()=>expect(api.previewDateRepair).toHaveBeenCalledOnce());
 await choose(b.bookingId);resolve(preview);await waitFor(()=>expect(screen.queryByRole("heading",{name:"Repair preview"})).not.toBeInTheDocument());
 await choose(a.bookingId);expect(screen.getByLabelText("Value for public_start")).toHaveValue("2027-07-21");
});
