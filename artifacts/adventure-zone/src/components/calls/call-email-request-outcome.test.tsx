import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: () => <p>Timeline content</p>,
}));

import { CallWorkspace } from "./call-workspace";

const organization = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Example Event",
  lastResort: false,
  lastResortReason: null,
};

const contact = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Avery Lee",
  phone: null,
  email: "avery@example.test",
  city: "Fargo",
  region: "ND",
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("email requested call outcome", () => {
  it("offers Asked me to send an email as a call disposition", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "70000000-0000-4000-8000-000000000001",
    });

    render(
      <CallWorkspace
        assistedCallingEnabled
        booking={null}
        contact={contact}
        followUp={null}
        onComplete={vi.fn().mockResolvedValue({ ok: true })}
        organization={organization}
        phones={[]}
        timeline={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));

    expect(screen.getByRole("option", { name: "Asked me to send an email" }))
      .toHaveAttribute("value", "email_requested");
  });
});
