import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsContractsPage from "./SettingsContractsPage";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));
vi.mock("@/features/contracts/contract-client", () => ({ contractClient: mocks }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ enabled: true, internalSignerName: "Dave Gordon", internalSignerEmail: "dave@example.com", internalSignerOrder: 2, insuranceRecipientName: "Amanda Morton", insuranceRecipientEmail: "amanda@protectiveins.net" });
  mocks.updateSettings.mockImplementation(async (input) => ({ settings: { ...input, internalSignerOrder: 2 } }));
});
afterEach(cleanup);

describe("SettingsContractsPage", () => {
  it("shows Dave, Amanda as primary, Sara as backup, fixed second signing order, and future-draft scope", async () => {
    render(<SettingsContractsPage />);
    expect(await screen.findByDisplayValue("Dave Gordon")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Amanda Morton")).toBeInTheDocument();
    expect(screen.getByDisplayValue("amanda@protectiveins.net")).toBeInTheDocument();
    expect(screen.getByText(/Backup: Sara Toone at sara@protectiveins\.net/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("2 — signs second")).toBeDisabled();
    expect(screen.getByText(/future contract drafts only/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/signature image/i)).not.toBeInTheDocument();
  });

  it("rejects an invalid signer email and saves valid edits", async () => {
    render(<SettingsContractsPage />);
    await screen.findByDisplayValue("Dave Gordon");
    fireEvent.change(screen.getByLabelText("Dave's signing email"), { target: { value: "invalid" } });
    fireEvent.submit(screen.getByRole("form", { name: "Contract settings" }));
    expect(screen.getByRole("alert")).toHaveTextContent("valid email");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Dave's signing email"), { target: { value: "dave@adventure.example" } });
    fireEvent.submit(screen.getByRole("form", { name: "Contract settings" }));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ internalSignerEmail: "dave@adventure.example", insuranceRecipientEmail: "amanda@protectiveins.net" })));
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });
});
