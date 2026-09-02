import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Switch } from "wouter";
import type { ComputerCallState } from "@/hooks/use-computer-call";
import { buildCallDraftKey, saveCallDraft } from "@/features/calls/call-draft";

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

function routedWorkspace() {
  return render(
    <Switch>
      <Route path="/calls/workspace">
        <CallWorkspace
          booking={null}
          computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }}
          contact={contact}
          followUp={null}
          onComplete={vi.fn().mockResolvedValue({ ok: true })}
          organization={organization}
          phones={[phone]}
          timeline={[]}
          voicemailLauncherUrl={null}
        />
      </Route>
      <Route path="/today"><p>Today destination</p></Route>
    </Switch>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
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
    await waitFor(() => expect(screen.getByText("Waiting for authoritative call details before recording the outcome.")).toBeInTheDocument());
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

  it("keeps reconciled technical linkage immutable and clears prior Phone Link drafts", async () => {
    const draftKey = buildCallDraftKey({ organizationId: organization.id, contactId: contact.id, bookingId: null, followUpId: null });
    saveCallDraft(draftKey, {
      version: 1, savedAt: "", requestKey: "phone-link-request", selectedPhoneId: phone.id,
      direction: "outgoing", method: "standard_call", scriptKind: "first_outreach", note: "Prior Phone Link draft.",
      disposition: "no_answer", nextActionKind: "", nextActionDate: "", lastResortConfirmed: false,
      lastResortReason: "", doNotCallConfirmed: false, doNotCallReason: "", doNotCallPhoneId: null,
    });
    computerHook.state = terminalState(true);
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    const view = workspace(onComplete, [phone, secondPhone]);

    await screen.findByText("Draft restored.");
    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: secondPhone.id } });
    expect(screen.getByLabelText("Phone number")).toHaveValue(phone.id);
    await waitFor(() => expect(localStorage.getItem(draftKey)).toBeNull());

    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Technical call outcome." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: "70000000-0000-4000-8000-000000000007",
      method: "browser_voip",
      phoneId: phone.id,
      endedAt: new Date("2026-09-01T10:03:15.000Z"),
    })));
    expect(screen.getByLabelText("Phone number")).not.toBeDisabled();

    view.unmount();
    workspace(undefined, [phone, secondPhone]);
    await waitFor(() => expect(screen.queryByText("Draft restored.")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start call note" })).toBeInTheDocument();
  });

  it("warns only while real panel lifecycle phases are live", async () => {
    computerHook.state = { ...idleState(), phase: "requesting-intent", sessionId: "70000000-0000-4000-8000-000000000007" };
    const view = workspace();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());
    const liveUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(liveUnload);
    expect(liveUnload.defaultPrevented).toBe(true);
    const link = document.createElement("a");
    link.href = "/today";
    document.body.append(link);
    const liveNavigation = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(liveNavigation);
    expect(confirm).toHaveBeenCalledOnce();
    expect(liveNavigation.defaultPrevented).toBe(true);

    computerHook.state = terminalState(false);
    view.rerender(
      <CallWorkspace booking={null} computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }} contact={contact} followUp={null} onComplete={vi.fn().mockResolvedValue({ ok: true })} organization={organization} phones={[phone]} timeline={[]} voicemailLauncherUrl={null} />,
    );
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());
    const terminalUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(terminalUnload);
    expect(terminalUnload.defaultPrevented).toBe(false);
    link.remove();
  });

  it.each([
    ["Back", "/today", { source: "back" }],
    ["Forward", "/command", { source: "forward" }],
  ] as const)("cancels browser %s navigation by restoring the live workspace route and state", async (_direction, destination, destinationState) => {
    const workspaceState = { callWorkspace: "live", preserved: 7 };
    window.history.replaceState(workspaceState, "", "/calls/workspace?contactId=20000000-0000-4000-8000-000000000001");
    computerHook.state = { ...idleState(), phase: "requesting-intent", sessionId: "70000000-0000-4000-8000-000000000007" };
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const view = workspace();

    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Keep the live call note." } });
    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());

    window.history.replaceState(destinationState, "", destination);
    window.dispatchEvent(new PopStateEvent("popstate", { state: destinationState }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/calls/workspace?contactId=20000000-0000-4000-8000-000000000001",
    );
    expect(window.history.state).toEqual(workspaceState);

    computerHook.state = terminalState(true);
    view.rerender(
      <CallWorkspace booking={null} computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }} contact={contact} followUp={null} onComplete={vi.fn().mockResolvedValue({ ok: true })} organization={organization} phones={[phone]} timeline={[]} voicemailLauncherUrl={null} />,
    );
    expect(await screen.findByLabelText("Call note")).toHaveValue("Keep the live call note.");
  });

  it("restores the live workspace before Wouter can commit a cancelled popstate destination", async () => {
    const workspaceState = { callWorkspace: "wouter-live" };
    window.history.replaceState(workspaceState, "", "/calls/workspace?contactId=20000000-0000-4000-8000-000000000001");
    computerHook.state = { ...idleState(), phase: "connected", sessionId: "70000000-0000-4000-8000-000000000007" };
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    routedWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());

    const destinationState = { source: "wouter-popstate" };
    window.history.replaceState(destinationState, "", "/today");
    window.dispatchEvent(new PopStateEvent("popstate", { state: destinationState }));

    await waitFor(() => expect(screen.queryByText("Today destination")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Computer call" })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledOnce();
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/calls/workspace?contactId=20000000-0000-4000-8000-000000000001",
    );
    expect(window.history.state).toEqual(workspaceState);
  });

  it("allows confirmed history navigation once and removes every navigation warning immediately", async () => {
    window.history.replaceState({ callWorkspace: "live" }, "", "/calls/workspace?contactId=20000000-0000-4000-8000-000000000001");
    computerHook.state = { ...idleState(), phase: "connected", sessionId: "70000000-0000-4000-8000-000000000007" };
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    workspace();

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());

    const destinationState = { source: "confirmed-history" };
    window.history.replaceState(destinationState, "", "/today");
    window.dispatchEvent(new PopStateEvent("popstate", { state: destinationState }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/today");
    expect(window.history.state).toEqual(destinationState);

    const unloadAfterConfirmation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadAfterConfirmation);
    expect(unloadAfterConfirmation.defaultPrevented).toBe(false);

    window.history.replaceState({ source: "later-history" }, "", "/command");
    window.dispatchEvent(new PopStateEvent("popstate", { state: { source: "later-history" } }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("removes the history listener as soon as a live call reaches a terminal phase", async () => {
    window.history.replaceState({ callWorkspace: "live" }, "", "/calls/workspace?contactId=20000000-0000-4000-8000-000000000001");
    computerHook.state = { ...idleState(), phase: "ringing", sessionId: "70000000-0000-4000-8000-000000000007" };
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const view = workspace();

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    await waitFor(() => expect(screen.getByLabelText("Phone number")).toBeDisabled());

    computerHook.state = terminalState(false);
    view.rerender(
      <CallWorkspace booking={null} computerCalling={{ enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" }} contact={contact} followUp={null} onComplete={vi.fn().mockResolvedValue({ ok: true })} organization={organization} phones={[phone]} timeline={[]} voicemailLauncherUrl={null} />,
    );
    await waitFor(() => expect(screen.getByText("Waiting for authoritative call details before recording the outcome.")).toBeInTheDocument());

    const terminalDestination = { source: "terminal-history" };
    window.history.replaceState(terminalDestination, "", "/today");
    window.dispatchEvent(new PopStateEvent("popstate", { state: terminalDestination }));

    expect(confirm).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/today");
  });

  it("allows a failed computer setup to be cancelled before recording a Phone Link outcome", async () => {
    computerHook.state = { ...idleState(), phase: "failed", error: "Microphone access was denied." };
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    workspace(onComplete);

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
    expect(screen.getByRole("button", { name: "Cancel computer call" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start call note" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel computer call" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Computer call" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Logged after Phone Link fallback." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      method: "standard_call",
      requestKey: expect.any(String),
    })));
  });

  it("clears a failed terminal session before a second computer call can save its outcome", async () => {
    computerHook.state = { ...terminalState(true), phase: "failed", status: "failed" };
    computerHook.reset.mockImplementation(() => { computerHook.state = idleState(); });
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    workspace(onComplete);

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByLabelText("Call note");
    fireEvent.click(screen.getByRole("button", { name: "Set up another call" }));
    expect(computerHook.reset).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Computer call" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start call note" })).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).not.toBeDisabled();

    computerHook.state = {
      ...terminalState(true),
      sessionId: "70000000-0000-4000-8000-000000000008",
      startedAt: "2026-09-01T11:00:00.000Z",
      answeredAt: "2026-09-01T11:00:20.000Z",
      endedAt: "2026-09-01T11:01:15.000Z",
      durationSeconds: 55,
    };
    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("heading", { name: "Computer call" });
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
