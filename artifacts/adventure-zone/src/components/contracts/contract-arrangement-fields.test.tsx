import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editableContractValues } from "@/features/contracts/contract-form-values";
import { ContractArrangementFields } from "./contract-arrangement-fields";

afterEach(cleanup);

describe("ContractArrangementFields", () => {
  it("shows every guaranteed-fee term and switches to a clean pay-for-play branch", () => {
    const onChange = vi.fn();
    render(<ContractArrangementFields values={editableContractValues({})} onChange={onChange} />);
    expect(screen.getByLabelText("Total guaranteed fee")).toBeInTheDocument();
    expect(screen.getByLabelText("Deposit due date")).toBeInTheDocument();
    expect(screen.getByLabelText("Payment timing")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contract arrangement"), { target: { value: "pay_for_play" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      arrangement: "pay_for_play",
      commercialTerms: {
        arrangement: "pay_for_play", eventShareBasisPoints: 0, settlementTiming: "",
        ticketAuthority: "", collectionArrangement: "", upfrontChargeCents: 0,
      },
    }));
  });
});
