// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerActionCenter } from "./manager-action-center";

const mocks=vi.hoisted(()=>({api:vi.fn(async(path:string,options?:RequestInit)=>{
  if(path==="/manager/acknowledgments") return {acknowledgments:[{id:"ack-1",status:"waiting_acknowledgment",title:"Event time changed",items:[{id:"i1",label:"Start time",beforeValue:"4:00 PM",afterValue:"5:00 PM"}]}]};
  if(path==="/manager/acknowledgments/ack-1/acknowledge"&&options?.method==="POST") return {acknowledgment:{id:"ack-1",status:"needs_admin_review",title:"Event time changed",managerComment:"Can we do 5:30?",items:[]}};
  return {};
})}));
vi.mock("@/lib/manager-auth-context",()=>({useManagerAuth:()=>({managerApi:mocks.api})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

describe("ManagerActionCenter",()=>{
  it("keeps admin changes visible until the server accepts acknowledgment",async()=>{
    render(<ManagerActionCenter/>);
    expect(await screen.findByText("Event time changed")).toBeInTheDocument();
    expect(screen.getByText(/4:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/5:00 PM/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Acknowledge"})).toBeInTheDocument();
  });
  it("sends a manager comment and keeps the item visible as waiting for admin review",async()=>{
    render(<ManagerActionCenter/>);
    await screen.findByText("Event time changed");
    fireEvent.change(screen.getByLabelText("Optional comment"),{target:{value:"Can we do 5:30?"}});
    fireEvent.click(screen.getByRole("button",{name:"Acknowledge & Send Comment"}));
    await waitFor(()=>expect(mocks.api).toHaveBeenCalledWith("/manager/acknowledgments/ack-1/acknowledge",expect.objectContaining({method:"POST"})));
    expect(await screen.findByText(/Waiting for admin review/i)).toBeInTheDocument();
  });
});
