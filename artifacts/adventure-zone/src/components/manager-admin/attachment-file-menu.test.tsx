// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentFileMenu } from "./attachment-file-menu";

afterEach(cleanup);

describe("AttachmentFileMenu",()=>{
  it("offers plain destination choices and submits destination metadata",async()=>{
    const onFile=vi.fn(async()=>{});
    render(<AttachmentFileMenu attachment={{id:"att-1",fileName:"fuel.jpg"}} legs={[{id:"leg-a",name:"Kristy"}]} onFile={onFile}/>);
    fireEvent.click(screen.getByRole("button",{name:"Add to leg…"}));
    expect(screen.getByText("Add file to leg record")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Leg"),{target:{value:"leg-a"}});
    fireEvent.change(screen.getByLabelText("File as"),{target:{value:"expense_receipt"}});
    fireEvent.change(screen.getByLabelText("Expense ID"),{target:{value:"expense-1"}});
    fireEvent.change(screen.getByLabelText("Receipt ID"),{target:{value:"receipt-1"}});
    fireEvent.click(screen.getByRole("button",{name:"Add file"}));
    await waitFor(()=>expect(onFile).toHaveBeenCalledWith(expect.objectContaining({attachmentId:"att-1",destination:"expense_receipt",destinationMetadata:expect.objectContaining({legId:"leg-a",expenseId:"expense-1",receiptId:"receipt-1"})})));
  });

  it("keeps handoff/general filing simple with one destination record id",()=>{
    render(<AttachmentFileMenu attachment={{id:"att-1",fileName:"trailer.jpg"}} legs={[{id:"leg-a",name:"Kristy"}]} onFile={vi.fn(async()=>{})}/>);
    fireEvent.click(screen.getByRole("button",{name:"Add to leg…"}));
    fireEvent.change(screen.getByLabelText("File as"),{target:{value:"equipment_handoff_photo"}});
    expect(screen.getByLabelText("Handoff ID")).toBeInTheDocument();
    expect(screen.queryByLabelText("Latitude")).not.toBeInTheDocument();
  });
});
