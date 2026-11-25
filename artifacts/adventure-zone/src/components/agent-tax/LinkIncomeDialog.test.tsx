import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinkIncomeDialog } from "./LinkIncomeDialog";
import {
  linkRecordedIncome,
  listAvailableIncome,
  type AvailableIncome,
  type PayItem,
} from "@/features/agent-tax/client";
vi.mock("@/features/agent-tax/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/agent-tax/client")>()),
  listAvailableIncome: vi.fn(),
  linkRecordedIncome: vi.fn(),
}));
const item = {
  id: "week-3",
  title: "Week 3",
  earnedDate: "2026-09-22",
  remainingCents: 60000,
  revision: 3,
} as PayItem;
const income: AvailableIncome = {
  id: "income",
  title: "Pay",
  recordDate: "2026-11-17",
  amountCents: 120000,
  availableCents: 120000,
  counterparty: "Dave",
  revision: 2,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAvailableIncome).mockResolvedValue({
    records: [income],
    hasMore: false,
  });
});
it("applies part of a saved payment using both revisions without creating another income entry", async () => {
  const onSaved = vi.fn(),
    onClose = vi.fn();
  vi.mocked(linkRecordedIncome).mockResolvedValue({ item });
  render(<LinkIncomeDialog item={item} onSaved={onSaved} onClose={onClose} />);
  await screen.findByRole("option", { name: /2026-11-17.*Pay.*Dave/ });
  fireEvent.change(screen.getByLabelText(/Income already received/), {
    target: { value: income.id },
  });
  expect(
    (screen.getByLabelText(/Amount to apply/) as HTMLInputElement).value,
  ).toBe("600.00");
  fireEvent.change(screen.getByLabelText(/Amount to apply/), {
    target: { value: "600.01" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Apply to earned week",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(/Amount to apply/), {
    target: { value: "400.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply to earned week" }));
  await waitFor(() =>
    expect(linkRecordedIncome).toHaveBeenCalledWith(
      item.id,
      income,
      40000,
      item.revision,
    ),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});
it("keeps a failed/stale link on screen without reporting success", async () => {
  const onSaved = vi.fn(),
    onClose = vi.fn();
  vi.mocked(linkRecordedIncome).mockRejectedValue(
    new Error("The income changed"),
  );
  render(<LinkIncomeDialog item={item} onSaved={onSaved} onClose={onClose} />);
  await screen.findByRole("option", { name: /2026-11-17.*Pay.*Dave/ });
  fireEvent.change(screen.getByLabelText(/Income already received/), {
    target: { value: income.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply to earned week" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("The income changed");
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
