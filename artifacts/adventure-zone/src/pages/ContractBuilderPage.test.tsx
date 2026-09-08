import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContractDraft, ContractValues } from "@/features/contracts/contract-types";
import ContractBuilderPage from "./ContractBuilderPage";

const mocks = vi.hoisted(() => ({
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
  finalizeDraft: vi.fn(),
}));

vi.mock("@/features/contracts/contract-client", () => ({
  contractClient: mocks,
}));

const values: ContractValues = {
  organizationId: "org-1", organizationName: "Meeteetse Celebration", bookingId: "booking-1",
  eventName: "Labor Day Celebration", venueName: "Main Street",
  venueAddress: { address1: "100 Main", city: "Meeteetse", region: "WY", postalCode: "82433" },
  eventStartDate: "2026-09-05", eventEndDate: "2026-09-07", arrivalDate: "2026-09-04", departureDate: "2026-09-08",
  eventSigner: { name: "Pat Organizer", role: "Event Representative", email: "pat@example.com", phone: "307-555-0100", order: 1 },
  internalSigner: { name: "Dave Gordon", role: "Adventure Zone Representative", email: "dave@example.com", phone: "", order: 2 },
  packages: [{ id: "package-1", name: "Mechanical rides" }], physicalAttractionTotal: 10, travelLegName: "Wyoming",
  arrangement: "guaranteed_fee",
  commercialTerms: { guaranteedFeeCents: 500000, depositCents: 100000, balanceCents: 400000, eventPercentageBasisPoints: null, percentageBase: null, admissionPriceCents: null },
  operationalTerms: { ticketsPerRide: 4, hoursPerDay: 8, operatingDays: 3, powerConfirmed: false, siteAccessConfirmed: false, staffingConfirmed: false },
  coi: { certificateHolderName: "", certificateHolderAddress: "", additionalInsuredWording: "" },
};

function draft(ready = false): ContractDraft {
  return {
    id: "draft-1", bookingId: "booking-1", organizationId: "org-1", revision: 1,
    storedValues: { contract: values, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" } },
    validationState: { ready, errors: ready ? [] : [{ path: "operationalTerms", message: "Confirm the operating responsibilities." }], warnings: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDraft.mockResolvedValue({ draft: draft() });
  mocks.saveDraft.mockImplementation(async (_id, revision, nextValues) => ({ draft: { ...draft(true), revision: revision + 1, storedValues: { ...draft().storedValues, contract: nextValues } } }));
  mocks.finalizeDraft.mockResolvedValue({ version: { id: "version-1" }, reused: false });
});
afterEach(cleanup);

describe("ContractBuilderPage", () => {
  it("renders an autofilled draft whose optional builder sections have not been saved yet", async () => {
    mocks.getDraft.mockResolvedValue({
      draft: {
        ...draft(),
        storedValues: {
          ...draft().storedValues,
          contract: {
            organizationId: "org-1",
            organizationName: "Meeteetse Celebration",
            bookingId: "booking-1",
            eventName: "Labor Day Celebration",
            venueName: "Main Street",
            venueAddress: { address1: "100 Main", city: "Meeteetse", region: "WY", postalCode: "82433" },
            eventSigner: values.eventSigner,
            internalSigner: values.internalSigner,
            packages: [],
            coi: { certificateHolderName: "", certificateHolderAddress: "", additionalInsuredWording: "" },
          },
        },
      },
    });

    render(<ContractBuilderPage draftId="draft-1" />);

    expect(await screen.findByRole("heading", { name: "Build contract" })).toBeInTheDocument();
    expect(screen.getByLabelText("Guaranteed fee")).toHaveValue(0);
    expect(screen.getByLabelText("Power requirements confirmed")).not.toBeChecked();
  });

  it("shows missing fields, confirmations, signer order, and every arrangement branch", async () => {
    render(<ContractBuilderPage draftId="draft-1" />);
    expect(await screen.findByRole("heading", { name: "Build contract" })).toBeInTheDocument();
    expect(screen.getByText("Confirm the operating responsibilities.")).toBeInTheDocument();
    expect(screen.getByLabelText("Power requirements confirmed")).toBeInTheDocument();
    expect(screen.getByText(/1\. Pat Organizer/)).toBeInTheDocument();
    expect(screen.getByText(/2\. Dave Gordon/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Contract arrangement"), { target: { value: "pay_for_play" } });
    expect(screen.getByLabelText("Event percentage")).toBeInTheDocument();
    expect(screen.queryByLabelText("Guaranteed fee")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Contract arrangement"), { target: { value: "guarantee_plus_percentage" } });
    expect(screen.getByLabelText("Event percentage")).toBeInTheDocument();
    expect(screen.getByLabelText("Guaranteed fee")).toBeInTheDocument();
  });

  it("autosaves the expected revision, previews the reviewed values, and blocks generation until ready", async () => {
    render(<ContractBuilderPage draftId="draft-1" autosaveDelayMs={10} />);
    await screen.findByDisplayValue("Labor Day Celebration");
    expect(screen.getByRole("button", { name: "Generate contract" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Updated Celebration" } });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith("draft-1", 1, expect.objectContaining({ eventName: "Updated Celebration" })));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview contract" }));
    expect(screen.getByText(/Updated Celebration/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate contract" })).toBeEnabled();
  });
});
