// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BossWorkRequestDetail } from "../../features/boss-work-requests/boss-work-request-types";
const api=vi.hoisted(()=>({save:vi.fn(),submit:vi.fn()}));
vi.mock("../../features/boss-work-requests/boss-work-request-api",()=>({saveConventionDraft:api.save,submitConventionNotes:api.submit}));
import { ConventionPlanningForm, ConventionPlanningAnswers } from "./ConventionPlanningForm";
const detail:BossWorkRequestDetail={request:{id:"q1",type:"convention_planning_questionnaire",state:"waiting_on_dave",priority:"normal",title:"Convention Planning Decisions",instructions:null,dueAt:null,completedAt:null,createdAt:"2026-09-10",updatedAt:"2026-09-10"},draft:null,submissions:[],templateReview:null};
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe("ConventionPlanningForm",()=>{
  it("shows the owner's clarification note alongside editable saved answers",()=>{
    render(<ConventionPlanningForm detail={{...detail,request:{...detail.request,state:"returned_for_clarification"},events:[{actorKind:"owner",newState:"returned_for_clarification",note:"Which hotel dates do you want?",createdAt:"2026-09-10"}],draft:{requestId:"q1",bossAccountId:"dave",clientRevision:2,payload:{eventName:"Convention Planning Decisions",planningAnswers:{rmafAttendees:"Dave"}},updatedAt:"2026-09-10"}}} reload={async()=>{}} />);
    expect(screen.getByText("Which hotel dates do you want?")).toBeTruthy();
    expect((screen.getByLabelText("Attendees:") as HTMLInputElement).value).toBe("Dave");
    expect((screen.getByRole("button",{name:"Submit answers"}) as HTMLButtonElement).disabled).toBe(false);
  });
  it("shows all five draft sections and restores saved fields when reopened",async()=>{
    api.save.mockResolvedValue({accepted:true,draft:{clientRevision:1}});
    const view=render(<ConventionPlanningForm detail={detail} reload={async()=>{}} />);
    for(const title of [/ROCKY MOUNTAIN/,/WYOMING ASSOCIATION/,/HEARTLAND ASSOCIATION/,/WESTERN FAIRS/,/COLORADO ASSOCIATION/])expect(screen.getByRole("heading",{name:title})).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Attendees:"),{target:{value:"Dave and Desiree"}});
    fireEvent.change(screen.getByLabelText("Advertising choice:"),{target:{value:"No advertising"}});
    fireEvent.click(screen.getByRole("button",{name:"Save progress"}));
    await screen.findByText("Progress saved. You can leave and return later.");
    const payload=api.save.mock.calls[0][2];
    expect(payload.planningAnswers).toEqual({rmafAttendees:"Dave and Desiree",rmafAdvertising:"No advertising"});
    view.unmount();
    render(<ConventionPlanningForm detail={{...detail,draft:{requestId:"q1",bossAccountId:"dave",clientRevision:1,payload,updatedAt:"2026-09-10"}}} reload={async()=>{}} />);
    expect((screen.getByLabelText("Attendees:") as HTMLInputElement).value).toBe("Dave and Desiree");
    expect((screen.getByLabelText("Advertising choice:") as HTMLSelectElement).value).toBe("No advertising");
  });
  it("keeps answers on a failed submission and reuses its retry ID",async()=>{
    api.submit.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({created:true,submission:{id:"s1"}});
    render(<ConventionPlanningForm detail={detail} reload={async()=>{}} />);
    fireEvent.change(screen.getByLabelText("Attendees:"),{target:{value:"Dave"}});
    fireEvent.click(screen.getByRole("button",{name:"Submit answers"}));
    await screen.findByText("Offline");
    expect((screen.getByLabelText("Attendees:") as HTMLInputElement).value).toBe("Dave");
    fireEvent.click(screen.getByRole("button",{name:"Submit answers"}));
    await screen.findByText("Submitted answers");
    expect(api.submit.mock.calls[1][1]).toBe(api.submit.mock.calls[0][1]);
    expect(screen.queryByRole("button",{name:"Submit answers"})).toBeNull();
  });
  it("does not overwrite a conflicting saved draft",async()=>{
    api.save.mockResolvedValue({accepted:false,draft:{clientRevision:8}});
    render(<ConventionPlanningForm detail={detail} reload={async()=>{}} />);
    fireEvent.change(screen.getByLabelText("Attendees:"),{target:{value:"Keep my answer"}});
    fireEvent.click(screen.getByRole("button",{name:"Save progress"}));
    await screen.findByRole("alert");
    await waitFor(()=>expect((screen.getByRole("button",{name:"Save progress"}) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByLabelText("Attendees:") as HTMLInputElement).value).toBe("Keep my answer");
  });
  it("renders answers as readable text for owner review",()=>{
    render(<ConventionPlanningAnswers answers={{rmafAttendees:"Dave",budget:"$5,000",additionalNotes:"Ask before reserving"}} />);
    expect(screen.getByText("$5,000")).toBeTruthy();
    expect(screen.getByText("Ask before reserving")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
