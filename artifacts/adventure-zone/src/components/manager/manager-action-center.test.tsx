// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerActionCenter } from "./manager-action-center";

const mocks=vi.hoisted(()=>({api:vi.fn(async(path:string,options?:RequestInit)=>{
  if(path==="/manager/acknowledgments") return {acknowledgments:[{id:"ack-1",status:"waiting_acknowledgment",sourceType:"manager_message",title:"Load-in update",items:[{id:"i1",label:"Message",beforeValue:null,afterValue:"Please arrive at 8 AM."}]}]};
  if(path==="/manager/acknowledgments/ack-1/acknowledge"&&options?.method==="POST") return {acknowledgment:{id:"ack-1",status:"needs_admin_review",sourceType:"manager_message",title:"Load-in update",managerComment:"Can we do 8:30?",items:[]}};
  return {};
})}));
vi.mock("@/lib/manager-auth-context",()=>({useManagerAuth:()=>({managerApi:mocks.api})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

describe("ManagerActionCenter",()=>{
  it("shows admin messages as acknowledgment required",async()=>{
    render(<ManagerActionCenter/>);
    expect(await screen.findByText("Load-in update")).toBeInTheDocument();
    expect(screen.getByText("Acknowledgment required")).toBeInTheDocument();
    expect(screen.getByText(/Please arrive at 8 AM/)).toBeInTheDocument();
  });
  it("sends a manager comment and keeps the item visible as waiting for admin review",async()=>{
    render(<ManagerActionCenter/>);
    await screen.findByText("Load-in update");
    fireEvent.change(screen.getByLabelText("Optional comment"),{target:{value:"Can we do 8:30?"}});
    fireEvent.click(screen.getByRole("button",{name:"Acknowledge & Send Comment"}));
    await waitFor(()=>expect(mocks.api).toHaveBeenCalledWith("/manager/acknowledgments/ack-1/acknowledge",expect.objectContaining({method:"POST"})));
    expect(await screen.findByText(/Waiting for admin review/i)).toBeInTheDocument();
  });
});
