import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editableContractValues } from "@/features/contracts/contract-form-values";
import { ContractEventFields } from "./contract-event-fields";

afterEach(cleanup);

describe("ContractEventFields", () => {
  it("renders editable event, venue, and representative details", () => {
    render(<ContractEventFields values={editableContractValues({})} onChange={vi.fn()} />);
    for (const label of [
      "Organization name", "Event name", "Venue name", "Venue street address", "Venue address line 2",
      "Venue city", "Venue state", "Venue ZIP", "Event start date", "Event end date", "Travel leg",
      "Event signer name", "Event signer role", "Event signer email", "Event signer phone",
      "Physical attraction total",
    ]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
});
