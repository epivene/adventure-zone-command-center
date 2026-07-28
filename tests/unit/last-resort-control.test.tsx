// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LastResortControl } from "@/components/organizations/last-resort-control";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";

const organizationId = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

describe("LastResortControl", () => {
  it("requires confirmation and a nonblank reason before enabling", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <LastResortControl
        initialEnabled={false}
        initialReason={null}
        onSubmit={onSubmit}
        organizationId={organizationId}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark as Last Resort" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a Last Resort reason");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Last Resort reason"), "Repeated cancellations.");
    await user.click(
      screen.getByLabelText("I confirm this account should be marked Last Resort."),
    );
    await user.click(screen.getByRole("button", { name: "Mark as Last Resort" }));

    expect(onSubmit).toHaveBeenCalledWith({
      organizationId,
      enabled: true,
      reason: "Repeated cancellations.",
    });
  });

  it("requires explicit confirmation before clearing Last Resort", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <LastResortControl
        initialEnabled
        initialReason="Repeated cancellations."
        onSubmit={onSubmit}
        organizationId={organizationId}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear Last Resort" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Confirm before clearing");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(
      screen.getByLabelText("I confirm the Last Resort status should be cleared."),
    );
    await user.click(screen.getByRole("button", { name: "Clear Last Resort" }));

    expect(onSubmit).toHaveBeenCalledWith({
      organizationId,
      enabled: false,
      reason: "",
    });
  });

  it("renders an inherited warning with the organization reason", () => {
    render(
      <LastResortWarning
        organizationName="Marias Fair"
        reason="Repeated cancellations."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Marias Fair is marked Last Resort. Repeated cancellations.",
    );
  });
});
