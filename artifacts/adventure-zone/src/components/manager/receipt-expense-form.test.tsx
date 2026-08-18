// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string) => {
    if (path === "/manager/receipts/extract") return {
      suggestions: { merchant: "Pilot Travel Center", totalCents: 4876, taxCents: 276, occurredAt: "2026-08-17" },
      unavailable: false,
    };
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a", legName: "Leg A" }, managerApi: mocks.api }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({ queueManagerMutation: vi.fn(async () => ({})), flushManagerMutationQueue: vi.fn(async () => []) }));
vi.mock("@/lib/manager-blob-queue", () => ({ queueManagerBlob: vi.fn(async () => ({})), flushManagerBlobQueue: vi.fn(async () => []) }));

import { ReceiptExpenseForm } from "./receipt-expense-form";

beforeEach(() => {
  mocks.api.mockClear();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("ReceiptExpenseForm", () => {
  it("reads receipt suggestions into fields that remain editable", async () => {
    render(<ReceiptExpenseForm mode="receipt" />);
    const file = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Receipt photo"), { target: { files: [file] } });

    expect(await screen.findByDisplayValue("Pilot Travel Center")).toBeInTheDocument();
    expect(screen.getByLabelText("Total")).toHaveValue("48.76");
    expect(screen.getByLabelText("Tax")).toHaveValue("2.76");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-17");

    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "Corrected Merchant" } });
    expect(screen.getByLabelText("Merchant")).toHaveValue("Corrected Merchant");
  });
});
