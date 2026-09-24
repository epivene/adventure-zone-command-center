import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionResults } from "./ActionResults";
it("shows independent failures without claiming everything completed", () => {
  render(
    <ActionResults
      items={[
        { id: "a1", label: "Email", status: "succeeded", href: "/email/1" },
        { id: "a2", label: "Profile update", status: "failed", href: null },
      ]}
    />,
  );
  expect(screen.getByText("Profile update")).toBeTruthy();
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(screen.queryByText("Everything completed")).toBeNull();
});
it("does not offer resend for uncertain delivery", () => {
  render(
    <ActionResults
      items={[{ id: "a1", label: "Email", status: "uncertain", href: null }]}
    />,
  );
  expect(screen.getByText("Checking result")).toBeTruthy();
  expect(screen.queryByText("Send again")).toBeNull();
});

import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";
it("requires the owner to verify payment receipt before approving a financial action", () => {
  const approve = vi.fn();
  render(
    <ActionResults
      items={[
        {
          id: "payment",
          label: "Record payment",
          status: "prepared",
          href: null,
          confirmation: "payment_received",
        } as any,
      ]}
      onApprove={approve}
    />,
  );
  const button = screen.getByRole("button", { name: "Approve this action" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  expect(approve).toHaveBeenCalledWith("payment", "payment_received");
});

it("distinguishes invoices with identical payment amounts and blocks stale previews", () => {
  render(
    <ActionResults
      items={[
        {
          id: "a",
          label: "Payment · INV-001",
          status: "prepared",
          href: null,
          targetId: "invoice-one",
          revision: "rev-one",
          summary: "Balance $500 → $400",
          confirmation: "payment_received",
        },
        {
          id: "b",
          label: "Payment · INV-002",
          status: "prepared",
          href: null,
          targetId: "invoice-two",
          revision: "rev-two",
          summary: "Refresh invoice details",
          confirmation: "payment_received",
          approvalBlocked: true,
        },
      ]}
      onApprove={vi.fn()}
    />,
  );
  expect(screen.getByText(/invoice-one.*rev-one/)).toBeTruthy();
  expect(screen.getByText(/invoice-two.*rev-two/)).toBeTruthy();
  expect(screen.getByText("Payment · INV-001")).toBeTruthy();
  expect(screen.getByText("Payment · INV-002")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  expect(
    (
      screen.getAllByRole("button", {
        name: "Approve this action",
      })[1] as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
