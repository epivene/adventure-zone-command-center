import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallWorkspace } from "@/components/calls/call-workspace";

afterEach(cleanup);

describe("CallWorkspace compact mode", () => {
  it("does not spend full cards on missing phone, caller, or booking data", () => {
    render(
      <CallWorkspace
        booking={null}
        contact={null}
        followUp={null}
        mode="compact"
        onComplete={vi.fn().mockResolvedValue({ ok: true })}
        organization={null}
        phones={[]}
        timeline={[]}
      />,
    );

    expect(screen.getByText("No phone number on file")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Phone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Caller" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Booking snapshot" })).not.toBeInTheDocument();
  });
});