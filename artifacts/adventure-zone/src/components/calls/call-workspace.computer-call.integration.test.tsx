import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerCallState } from "@/hooks/use-computer-call";

const computerHook = vi.hoisted(() => ({
  renders: 0,
  state: null as unknown as ComputerCallState,
  setup: vi.fn(), callNow: vi.fn(), mute: vi.fn(), sendDigits: vi.fn(), hangUp: vi.fn(),
  selectInput: vi.fn(), selectOutput: vi.fn(), reset: vi.fn(),
}));

vi.mock("@/components/activities/activity-timeline", () => ({ ActivityTimeline: () => null }));
vi.mock("@/hooks/use-computer-call", () => ({
  useComputerCall: () => {
    computerHook.renders += 1;
    return computerHook;
  },
}));

import { CallWorkspace } from "./call-workspace";

const organization = { id: "10000000-0000-4000-8000-000000000001", name: "Acme Venue", lastResort: false, lastResortReason: null };
const contact = { id: "20000000-0000-4000-8000-000000000001", name: "Avery Lee", phone: null, email: null, city: null, region: null };
const phone = {
  id: "50000000-0000-4000-8000-000000000001", contactId: contact.id, number: "701-555-0199",
  normalizedNumber: "7015550199", extension: null, label: "Mobile", primary: true,
  source: "local", doNotCallAt: null, doNotCallReason: null, type: "mobile" as const,
};
const secondPhone = {
  ...phone,
  id: "50000000-0000-4000-8000-000000000002",
  number: "701-555-0101",
  normalizedNumber: "7015550101",
  primary: false,
};

function terminalState(reconciled: boolean): ComputerCallState {
  return {
    phase: "completed", sessionId: "70000000-0000-4000-8000-000000000007", muted: false,
    inputs: [], outputs: [], inputDeviceId: null, outputDeviceId: null,
    startedAt: "2026-09-01T10:00:00.000Z", answeredAt: "2026-09-01T10:00:20.000Z",
    endedAt: "2026-09-01T10:03:15.000Z", durationSeconds: 175, status: "busy",
    errorSummary: "Busy signal.", error: null, warning: null, reconciled,
  };
}

function idleState(): ComputerCallState {
  return {
    phase: "idle", sessionId: null, muted: false, inputs: [], outputs: [], inputDeviceId: null,
    outputDeviceId: null, startedAt: null, answeredAt: null, endedAt: null, durationSeconds: null,
    status: null, errorSummary: null, error: null, warning: null, reconciled: false,
  };
}

function workspace(onComplete = vi.fn().mockResolvedValue({ ok: true }), phones = [phone]) {
  return render(
    <CallWorkspace
      booking={null}
      computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }}
      contact={contact}
      followUp={null}
      onComplete={onComplete}
      organization={organization}
      phones={phones}
      timeline={[]}
      voicemailLauncherUrl={null}
    />,
  );
}

afterEach(() => {
  cleanup();
  computerHook.renders = 0;
  computerHook.state = terminalState(false);
  for (const action of [computerHook.setup, computerHook.callNow, computerHook.mute, computerHook.sendDigits, computerHook.hangUp, computerHook.selectInput, computerHook.selectOutput, computerHook.reset]) action.mockReset();
});

describe("CallWorkspace computer panel integration", () => {
  it("waits for reconciliation, emits terminal metadata once, and saves the reconciled session", async () => {
    computerHook.state = terminalState(false);
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    const view = workspace(onComplete);

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    expect(screen.getByText("Waiting for authoritative call details before recording the outcome.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start call note" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());

    computerHook.state = terminalState(true);
    view.rerender(
      <CallWorkspace
        booking={null}
        computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }}
        contact={contact}
        followUp={null}
        onComplete={onComplete}
        organization={organization}
        phones={[phone]}
        timeline={[]}
        voicemailLauncherUrl={null}
      />,
    );

    await screen.findByLabelText("Call note");
    await waitFor(() => expect(computerHook.renders).toBeLessThan(5));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Technical status reconciled." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: "70000000-0000-4000-8000-000000000007",
      method: "browser_voip",
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
      endedAt: new Date("2026-09-01T10:03:15.000Z"),
      phoneId: phone.id,
    }));
  });

  it("keeps the selected phone bound during intent and terminal reconciliation", async () => {
    computerHook.state = {
      ...idleState(),
      phase: "requesting-intent",
      sessionId: "70000000-0000-4000-8000-000000000007",
    };
    const view = workspace(undefined, [phone, secondPhone]);

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());
    expect(screen.getByLabelText("Phone number")).toHaveValue(phone.id);
    expect(screen.getByText("701-555-0199")).toBeInTheDocument();

    computerHook.state = { ...terminalState(false), status: "busy" };
    view.rerender(
      <CallWorkspace
        booking={null}
        computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }}
        contact={contact}
        followUp={null}
        onComplete={vi.fn().mockResolvedValue({ ok: true })}
        organization={organization}
        phones={[phone, secondPhone]}
        timeline={[]}
        voicemailLauncherUrl={null}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());
    expect(screen.getByText("701-555-0199")).toBeInTheDocument();
  });

  it("clears a failed terminal session before a second computer call can save its outcome", async () => {
    computerHook.state = { ...terminalState(true), phase: "failed", status: "failed" };
    computerHook.reset.mockImplementation(() => { computerHook.state = idleState(); });
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    const view = workspace(onComplete);

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByLabelText("Call note");
    fireEvent.click(screen.getByRole("button", { name: "Set up another call" }));
    expect(computerHook.reset).toHaveBeenCalledOnce();
    expect(screen.getByText("Waiting for authoritative call details before recording the outcome.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start call note" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).not.toBeDisabled();

    computerHook.state = {
      ...terminalState(true),
      sessionId: "70000000-0000-4000-8000-000000000008",
      startedAt: "2026-09-01T11:00:00.000Z",
      answeredAt: "2026-09-01T11:00:20.000Z",
      endedAt: "2026-09-01T11:01:15.000Z",
      durationSeconds: 55,
    };
    view.rerender(
      <CallWorkspace
        booking={null}
        computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }}
        contact={contact}
        followUp={null}
        onComplete={onComplete}
        organization={organization}
        phones={[phone]}
        timeline={[]}
        voicemailLauncherUrl={null}
      />,
    );
    await screen.findByLabelText("Call note");
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Second technical call." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: "70000000-0000-4000-8000-000000000008",
      startedAt: new Date("2026-09-01T11:00:00.000Z"),
      endedAt: new Date("2026-09-01T11:01:15.000Z"),
    })));
  });
});
