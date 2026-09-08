import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editableContractValues } from "@/features/contracts/contract-form-values";
import { ContractOperationalFields } from "./contract-operational-fields";

afterEach(cleanup);

describe("ContractOperationalFields", () => {
  it("renders every required operating responsibility question", () => {
    render(<ContractOperationalFields values={editableContractValues({})} onChange={vi.fn()} />);
    for (const label of [
      "Operating start date", "Operating end date", "Daily operating hours", "Work-day count",
      "Arrival date", "Departure date", "Attractions or package", "Space requirement",
      "Power requirement", "Water requirement", "Lodging requirement", "Setup and teardown terms",
      "Operational terms confirmed",
    ]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
});
