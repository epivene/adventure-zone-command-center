import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiPost = vi.fn();
vi.mock("@/lib/auth-token", () => ({ apiPost: (...args: unknown[]) => apiPost(...args) }));

import { EarlyBirdPromoCard, type EarlyBirdPromoView } from "./early-bird-promo-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const promotion: EarlyBirdPromoView = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Early Bird Promo",
  organizationId: "20000000-0000-4000-8000-000000000002",
  bookingId: null,
  eventYear: 2027,
  status: "active",
  firstSentAt: "2026-09-09T16:00:00.000Z",
  deadlineDate: "2026-10-21",
  interestConfirmedAt: null,
  reminderDueAt: null,
  reminderPrepared: false,
  depositReceivedAt: null,
  cancelReason: null,
};

describe("EarlyBirdPromoCard", () => {
  it("shows the shared offer deadline and records expressed interest", async () => {
    const onChanged = vi.fn();
    apiPost.mockResolvedValueOnce({ promotion: { ...promotion, interestConfirmedAt: "2026-09-24T16:00:00.000Z" } });
    render(<EarlyBirdPromoCard promotion={promotion} onChanged={onChanged} />);

    expect(screen.getByText("Early Bird Promo")).toBeInTheDocument();
    expect(screen.getByText(/10% off/)).toBeInTheDocument();
    expect(screen.getByText(/October 21, 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark interest confirmed" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      `/early-bird-promo/${promotion.id}/interest`,
      {},
    ));
    expect(onChanged).toHaveBeenCalled();
  });

  it("records a deposit and labels a secured offer", async () => {
    const onChanged = vi.fn();
    apiPost.mockResolvedValueOnce({ promotion: { ...promotion, status: "secured" } });
    const { rerender } = render(<EarlyBirdPromoCard promotion={promotion} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Record deposit" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      `/early-bird-promo/${promotion.id}/deposit`,
      { source: "owner_profile" },
    ));

    rerender(<EarlyBirdPromoCard promotion={{ ...promotion, status: "secured", depositReceivedAt: "2026-09-24T16:00:00.000Z" }} onChanged={onChanged} />);
    expect(screen.getByText("Promo secured")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record deposit" })).not.toBeInTheDocument();
  });

  it("collects a reason before cancelling", async () => {
    apiPost.mockResolvedValueOnce({ promotion: { ...promotion, status: "cancelled" } });
    render(<EarlyBirdPromoCard promotion={promotion} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel promo" }));
    fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Customer declined" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      `/early-bird-promo/${promotion.id}/cancel`,
      { reason: "Customer declined" },
    ));
  });
});
