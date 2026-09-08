import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContractAction } from "./contract-action";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), startDraft: vi.fn() }));
vi.mock("@/features/contracts/contract-client", () => ({ contractClient: mocks }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ enabled: true });
  mocks.startDraft.mockResolvedValue({ draft: { id: "new-draft" }, reused: false });
});
afterEach(cleanup);

describe("ContractAction", () => {
  it("lets a profile choose among multiple bookings", async () => {
    render(<ContractAction bookings={[{ id: "one", name: "First event", openDraftId: null }, { id: "two", name: "Second event", openDraftId: "draft-two" }]} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create contract" }));
    expect(screen.getByLabelText("Choose booking")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose booking"), { target: { value: "two" } });
    expect(screen.getByRole("button", { name: "Continue contract" })).toBeInTheDocument();
  });

  it("preselects a booking and continues its existing draft", async () => {
    const navigate = vi.fn();
    render(<ContractAction bookingId="one" bookings={[{ id: "one", name: "First event", openDraftId: "draft-one" }]} onNavigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue contract" }));
    expect(navigate).toHaveBeenCalledWith("/contracts/drafts/draft-one");
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });

  it("starts a new draft and hides itself when the feature is off", async () => {
    const navigate = vi.fn();
    const page = render(<ContractAction bookingId="one" bookings={[{ id: "one", name: "First event", openDraftId: null }]} onNavigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create contract" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/contracts/drafts/new-draft"));
    page.unmount();
    mocks.getSettings.mockResolvedValue({ enabled: false });
    render(<ContractAction bookingId="one" bookings={[{ id: "one", name: "First event", openDraftId: null }]} />);
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /contract/i })).not.toBeInTheDocument();
  });
});
