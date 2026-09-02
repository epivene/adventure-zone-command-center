import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerCallState } from "@/hooks/use-computer-call";

const hook = vi.hoisted(() => ({
  state: {
    phase: "idle",
    sessionId: null,
    muted: false,
    inputs: [],
    outputs: [],
    inputDeviceId: null,
    outputDeviceId: null,
    startedAt: null,
    answeredAt: null,
    endedAt: null,
    durationSeconds: null,
    status: null,
    errorSummary: null,
    error: null,
    warning: null,
    reconciled: false,
  } as ComputerCallState,
  setup: vi.fn(),
  callNow: vi.fn(),
  mute: vi.fn(),
  sendDigits: vi.fn(),
  hangUp: vi.fn(),
  selectInput: vi.fn(),
  selectOutput: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/hooks/use-computer-call", () => ({ useComputerCall: () => hook }));

import { ComputerCallPanel } from "./computer-call-panel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hook.state = {
    phase: "idle", sessionId: null, muted: false, inputs: [], outputs: [], inputDeviceId: null,
    outputDeviceId: null, startedAt: null, answeredAt: null, endedAt: null,
    durationSeconds: null, status: null, errorSummary: null, error: null, warning: null,
    reconciled: false,
  };
  hook.setup.mockReset();
  hook.callNow.mockReset();
  hook.mute.mockReset();
  hook.sendDigits.mockReset();
  hook.hangUp.mockReset();
  hook.selectInput.mockReset();
  hook.selectOutput.mockReset();
  hook.refresh.mockReset();
  hook.reset.mockReset();
});

const contact = { id: "20000000-0000-4000-8000-000000000001", name: "Avery Lee" };
const phone = {
  id: "50000000-0000-4000-8000-000000000001",
  contactId: contact.id,
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

describe("ComputerCallPanel", () => {
  it("updates the connected timer without starting a new call", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
    hook.state = {
      ...hook.state,
      phase: "connected",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
    };
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        organizationId="10000000-0000-4000-8000-000000000001"
        phone={phone}
      />,
    );

    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByText("Duration: 00:01")).toHaveAttribute("aria-live", "off");
    expect(hook.callNow).not.toHaveBeenCalled();
  });

  it("confirms the contact and configured caller ID before microphone setup and explicit dialing", () => {
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        organizationId="10000000-0000-4000-8000-000000000001"
        phone={phone}
      />,
    );

    expect(screen.getByText("Avery Lee")).toBeInTheDocument();
    expect(screen.getByText("701-555-0199")).toBeInTheDocument();
    expect(screen.getByText(/Adventure Zone work number.*701/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up microphone" }));
    expect(hook.setup).toHaveBeenCalledOnce();
    expect(hook.callNow).not.toHaveBeenCalled();
  });

  it("renders accessible active controls and sends technical completion to the workspace", () => {
    hook.state = {
      ...hook.state,
      phase: "connected",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      inputs: [{ deviceId: "mic-1", label: "Desk microphone" } as MediaDeviceInfo],
      outputs: [{ deviceId: "speaker-1", label: "Desk speakers" } as MediaDeviceInfo],
    };
    const onTerminal = vi.fn();
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={onTerminal}
        organizationId="10000000-0000-4000-8000-000000000001"
        phone={phone}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Connected");
    expect(screen.getByRole("button", { name: "Mute microphone" })).toBeInTheDocument();
    expect(screen.getByLabelText("Microphone")).toBeInTheDocument();
    expect(screen.getByLabelText("Speaker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keypad 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Hang up" }));
    expect(hook.sendDigits).toHaveBeenCalledWith("5");
    expect(hook.hangUp).toHaveBeenCalledOnce();
  });

  it("shows speaker fallback and technical result without hiding recovery guidance", () => {
    hook.state = {
      ...hook.state,
      phase: "failed",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
      error: "Microphone access was denied.",
      errorSummary: "failed",
      warning: "Speaker selection is not supported by this browser.",
      reconciled: true,
    };
    const onTerminal = vi.fn();
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={onTerminal}
        organizationId="10000000-0000-4000-8000-000000000001"
        phone={phone}
      />,
    );

    expect(screen.getByText("Speaker selection is not supported by this browser.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Microphone access was denied.");
    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
    }));
  });

  it("emits one authoritative terminal result only after reconciliation", () => {
    hook.state = {
      ...hook.state,
      phase: "completed",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      answeredAt: "2026-09-01T10:00:20.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
      durationSeconds: 175,
      status: "no-answer",
      errorSummary: "The recipient did not answer.",
      reconciled: false,
      inputs: [{ deviceId: "mic-1", label: "Desk microphone" } as MediaDeviceInfo],
      outputs: [{ deviceId: "speaker-1", label: "Desk speakers" } as MediaDeviceInfo],
    };
    const firstCallback = vi.fn();
    const view = render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={firstCallback}
        organizationId="10000000-0000-4000-8000-000000000001"
        phone={phone}
      />,
    );

    expect(firstCallback).not.toHaveBeenCalled();
    expect(screen.getByText("Confirming technical call details before recording the outcome.")).toBeInTheDocument();
    expect(screen.queryByText("Technical result: no answer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Microphone")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Speaker")).not.toBeInTheDocument();

    hook.state = { ...hook.state, reconciled: true };
    view.rerender(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={firstCallback}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
    }));
    expect(screen.getByText("Technical result: no answer")).toBeInTheDocument();
    expect(screen.getByText("The recipient did not answer.")).toBeInTheDocument();
    expect(screen.getByText("Answered: 2026-09-01T10:00:20.000Z")).toBeInTheDocument();
    expect(screen.getByText("Ended: 2026-09-01T10:03:15.000Z")).toBeInTheDocument();

    const secondCallback = vi.fn();
    view.rerender(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={secondCallback}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it("keeps the phone bound when a ready call becomes a terminal session", () => {
    hook.state = { ...hook.state, phase: "ready" };
    const onTerminal = vi.fn();
    const view = render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={onTerminal}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Call now" }));
    const switchedPhone = { ...phone, id: "50000000-0000-4000-8000-000000000002", number: "701-555-0101" };
    view.rerender(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={onTerminal}
        organizationId="10000000-0000-4000-000000000001"
        phone={switchedPhone}
      />,
    );
    expect(screen.getByRole("button", { name: "Call now" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Call now" }));
    expect(hook.callNow).toHaveBeenCalledOnce();
    hook.state = {
      ...hook.state,
      phase: "completed",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
      durationSeconds: 195,
      status: "completed",
      errorSummary: null,
      reconciled: true,
    };
    view.rerender(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onTerminal={onTerminal}
        organizationId="10000000-0000-4000-000000000001"
        phone={switchedPhone}
      />,
    );

    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ phoneId: phone.id }));
  });

  it("requires reset instead of direct microphone setup after a failed technical session", () => {
    hook.state = {
      ...hook.state,
      phase: "failed",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
      status: "failed",
      reconciled: false,
    };
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );

    expect(screen.queryByRole("button", { name: "Set up microphone" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up another call" })).toBeInTheDocument();
  });

  it("offers a technical refresh while a terminal session is awaiting reconciliation", () => {
    hook.state = {
      ...hook.state,
      phase: "completed",
      sessionId: "70000000-0000-4000-8000-000000000007",
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T10:03:15.000Z",
      warning: null,
      reconciled: false,
    };
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh technical details" }));
    expect(hook.refresh).toHaveBeenCalledOnce();
  });

  it("lets a user cancel computer calling and return to the Phone Link fallback", () => {
    hook.state = { ...hook.state, phase: "failed", error: "Microphone access was denied." };
    const onClose = vi.fn();
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        onClose={onClose}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel computer call" }));
    expect(hook.reset).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the confirmation heading and separates the live status from its timer", () => {
    hook.state = { ...hook.state, phase: "connected", startedAt: "2026-09-01T10:00:00.000Z" };
    render(
      <ComputerCallPanel
        callerIdDisplay="(701) 555-0100"
        contact={contact}
        organizationId="10000000-0000-4000-000000000001"
        phone={phone}
      />,
    );

    expect(screen.getByRole("heading", { name: "Computer call" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/^Duration:/)).toHaveAttribute("aria-live", "off");
  });
});
