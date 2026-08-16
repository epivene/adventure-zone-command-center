// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcknowledgmentReview } from "./acknowledgment-review";

afterEach(cleanup);

describe("AcknowledgmentReview",()=>{
  it("shows the original grouped change and manager comment, then resolves with an admin response",async()=>{
    const onResolve=vi.fn(async()=>{});
    render(<AcknowledgmentReview acknowledgment={{id:"ack-1",title:"Route changed",managerComment:"Please double-check this stop.",items:[{id:"i1",label:"Stop",beforeValue:"Mandan",afterValue:"Bismarck"}]}} onResolve={onResolve}/>);
    expect(screen.getByText("Route changed")).toBeInTheDocument();
    expect(screen.getByText(/Please double-check this stop/)).toBeInTheDocument();
    expect(screen.getByText(/Mandan/)).toBeInTheDocument();
    expect(screen.getByText(/Bismarck/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Admin response"),{target:{value:"Confirmed — Bismarck is correct."}});
    fireEvent.click(screen.getByRole("button",{name:"Resolve"}));
    await waitFor(()=>expect(onResolve).toHaveBeenCalledWith("ack-1","Confirmed — Bismarck is correct."));
  });
});
