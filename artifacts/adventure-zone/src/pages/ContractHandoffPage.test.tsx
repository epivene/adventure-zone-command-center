import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ContractHandoffPage from "./ContractHandoffPage";

const mocks = vi.hoisted(() => ({ getVersion: vi.fn(), openFile: vi.fn(), confirmAdobeSent: vi.fn() }));
vi.mock("@/features/contracts/contract-client", () => ({ contractClient: mocks }));

const version = {
  id: "version-1", bookingId: "booking-1", organizationId: "org-1", status: "ready_for_adobe",
  snapshot: {
    insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" },
    values: {
      eventName: "Labor Day Celebration",
      eventSigner: { name: "Pat Organizer", email: "pat@example.com", role: "Event Representative", order: 1 },
      internalSigner: { name: "Dave Gordon", email: "dave@example.com", role: "Adventure Zone Representative", order: 2 },
    },
  },
  files: [{ id: "file-1", kind: "unsigned_generated", revision: 1, originalFilename: "contract-unsigned.pdf", confirmedAt: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVersion.mockResolvedValue({ version });
  mocks.openFile.mockResolvedValue({ url: "https://private.example/pdf" });
  mocks.confirmAdobeSent.mockResolvedValue({ state: { contractStatus: "sent_for_signature" }, reused: false });
  vi.spyOn(window, "open").mockImplementation(() => null);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);

describe("ContractHandoffPage", () => {
  it("provides an explicit PDF and Adobe handoff in event-first order", async () => {
    render(<ContractHandoffPage contractVersionId="version-1" />);
    expect(await screen.findByRole("heading", { name: "Send through Adobe" })).toBeInTheDocument();
    expect(screen.getByText("1. Pat Organizer")).toBeInTheDocument();
    expect(screen.getByText("2. Dave Gordon")).toBeInTheDocument();
    expect(screen.getByText(/signature and date fields for both signers/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Adobe Request e-signatures" })).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Open contract PDF" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://private.example/pdf", "_blank", "noopener,noreferrer"));
    fireEvent.click(screen.getByRole("button", { name: "Copy agreement name" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Labor Day Celebration Agreement");
  });

  it("requires explicit Adobe confirmation before advancing", async () => {
    render(<ContractHandoffPage contractVersionId="version-1" />);
    const button = await screen.findByRole("button", { name: "Confirm sent through Adobe" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I sent it through Adobe"));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByText("Sent for signature")).toBeInTheDocument();
    expect(mocks.confirmAdobeSent).toHaveBeenCalledWith("version-1");
  });
});
