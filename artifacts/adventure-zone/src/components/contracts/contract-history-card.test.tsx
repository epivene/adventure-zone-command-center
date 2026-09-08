import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContractHistoryCard } from "./contract-history-card";

afterEach(cleanup);

describe("ContractHistoryCard", () => {
  it("shows immutable version status, file history, replacement link, and next action", () => {
    render(<ContractHistoryCard version={{
      id: "version-2", bookingId: "booking-1", organizationId: "org-1", status: "ready_for_adobe",
      versionNumber: 2, predecessorVersionId: "version-1", supersedingVersionId: null,
      snapshot: { values: { eventName: "Labor Day Celebration" }, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" } },
      files: [{ id: "file-1", kind: "unsigned_generated", revision: 1, originalFilename: "contract.pdf", confirmedAt: null }],
    } as never} />);
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("Ready for Adobe")).toBeInTheDocument();
    expect(screen.getByText("contract.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Replaces version/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send through Adobe" })).toHaveAttribute("href", "/contracts/version-2/handoff");
  });
});
