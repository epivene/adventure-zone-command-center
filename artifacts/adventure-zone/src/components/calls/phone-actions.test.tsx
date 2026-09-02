import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneActions } from "./phone-actions";

const phone = {
  id: "50000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  number: "701-555-0199",
  normalizedNumber: "7015550199",
  extension: null,
  label: "Mobile",
  primary: true,
  source: "local",
  doNotCallAt: null,
  doNotCallReason: null,
  type: "mobile" as const,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PhoneActions computer calling", () => {
  it("opens computer calling while retaining the Phone Link fallback", () => {
    const onStartComputerCall = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign }, navigator: { clipboard: { writeText: vi.fn() } } });

    render(
      <PhoneActions
        computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }}
        onStartComputerCall={onStartComputerCall}
        phone={phone}
        voicemailLauncherUrl={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    fireEvent.click(screen.getByRole("button", { name: "Call with Phone Link" }));

    expect(onStartComputerCall).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("tel:7015550199");
  });

  it.each([
    ["disabled", "Computer calling is disabled."],
    ["configuration_incomplete", "Computer calling is not configured."],
  ] as const)("keeps Phone Link as the only call action when %s", (reason, message) => {
    render(
      <PhoneActions
        computerCalling={{ enabled: false, reason, callerIdDisplay: null }}
        phone={phone}
        voicemailLauncherUrl={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Call from computer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
