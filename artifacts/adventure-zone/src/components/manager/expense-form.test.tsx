// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseForm } from "./expense-form";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(async (mutation: any) => ({ ...mutation, state: "saved_offline" })),
  flush: vi.fn(async () => []),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: vi.fn() }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: mocks.queue,
  flushManagerMutationQueue: mocks.flush,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExpenseForm", () => {
  it("explains personal reimbursement and queues the expense", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<ExpenseForm />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "42.50" } });
    fireEvent.change(screen.getByLabelText("Payment source"), { target: { value: "personal" } });
    expect(screen.getByText(/Adventure Zone owes you reimbursement/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(1));
    expect(mocks.queue.mock.calls[0][0].body.amountCents).toBe(4250);
  });

  it("does not describe company debit as personal reimbursement", () => {
    render(<ExpenseForm />);
    fireEvent.change(screen.getByLabelText("Payment source"), {
      target: { value: "adventure_zone_debit" },
    });
    expect(screen.queryByText(/Adventure Zone owes you reimbursement/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Company debit spending is a company expense and does not create personal reimbursement/i),
    ).toBeInTheDocument();
  });
});
