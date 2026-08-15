// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerMoneyPage from "./ManagerMoneyPage";

const mocks=vi.hoisted(()=>({
  api:vi.fn(async(path:string)=> path==="/manager/dashboard"?{events:[{id:"stop-1",bookingId:"00000000-0000-4000-8000-000000000010",name:"Town Festival",startsAt:"2026-08-20T12:00:00Z"}]}:{incomeTotalCents:0,expenseTotalCents:0,cashPosition:{cashOnHandCents:0},settlement:{ownerOwesManagerCents:2500,managerOwesOwnerCents:0,netCents:2500}}),
  queue:vi.fn(async(m:any)=>({...m,state:"saved_offline"})),
  flush:vi.fn(async()=>[]),
}));
vi.mock("@/lib/manager-auth-context",()=>({useManagerAuth:()=>({manager:{legId:"leg-a",legName:"Leg A",managerName:"Amy"},managerApi:mocks.api})}));
vi.mock("@/lib/manager-sync-queue",()=>({queueManagerMutation:mocks.queue,flushManagerMutationQueue:mocks.flush}));
afterEach(()=>{cleanup();vi.clearAllMocks();});

describe("ManagerMoneyPage",()=>{
  it("shows settlement direction and queues manual event income",async()=>{
    render(<ManagerMoneyPage/>);
    expect(await screen.findByText("Adventure Zone owes you $25.00")).toBeInTheDocument();
    expect(screen.getByRole("option",{name:"Town Festival"})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cash"),{target:{value:"120.50"}});
    fireEvent.change(screen.getByLabelText("Square / card"),{target:{value:"80"}});
    fireEvent.click(screen.getByRole("button",{name:"Save income"}));
    await waitFor(()=>expect(mocks.queue).toHaveBeenCalledTimes(1));
    const mutation=mocks.queue.mock.calls[0][0];
    expect(mutation.path).toBe("/manager/income");
    expect(mutation.body.cashCents).toBe(12050);
    expect(mutation.body.squareCents).toBe(8000);
    expect(screen.getByText(/Saved offline|Syncing|Synced/)).toBeInTheDocument();
  });
});
