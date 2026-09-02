import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComputerCallTerminal } from "@/components/calls/computer-call-panel";
import { buildCallDraftKey } from "@/features/calls/call-draft";

vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: () => <p>Timeline content</p>,
}));
vi.mock("@/components/calls/computer-call-panel", () => ({
  ComputerCallPanel: ({ onPhaseChange, onTerminal }: {
    onPhaseChange?: (active: boolean) => void;
    onTerminal: (call: ComputerCallTerminal) => void;
  }) => (
    <>
      <button onClick={() => onPhaseChange?.(true)} type="button">Simulate active computer call</button>
      <button onClick={() => {
        onPhaseChange?.(false);
        onTerminal({
          sessionId: "70000000-0000-4000-8000-000000000007",
          phoneId: "50000000-0000-4000-8000-000000000001",
          startedAt: "2026-09-01T10:00:00.000Z",
          answeredAt: "2026-09-01T10:00:20.000Z",
          endedAt: "2026-09-01T10:03:15.000Z",
          durationSeconds: 175,
          status: "completed",
          errorSummary: null,
        });
      }} type="button">Finish computer call</button>
    </>
  ),
}));

import { CallWorkspace } from "./call-workspace";

const organization = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Acme Venue",
  lastResort: false,
  lastResortReason: null,
};
const contact = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Avery Lee",
  phone: "701-555-0100",
  email: null,
  city: "Fargo",
  region: "ND",
};
const phoneBase = {
  id: "50000000-0000-4000-8000-000000000001",
  contactId: contact.id,
  number: "701-555-0199",
  normalizedNumber: "7015550199",
  extension: null,
  label: null,
  primary: true,
  source: "local",
  doNotCallAt: null,
  doNotCallReason: null,
};
const followUp = {
  id: "60000000-0000-4000-8000-000000000001",
  kind: "call",
  dueAt: new Date("2026-08-13T15:00:00.000Z"),
};

function renderWorkspace(overrides: Record<string, unknown> = {}) {
  const onComplete = vi.fn().mockResolvedValue({ ok: true });
  const view = render(
    <CallWorkspace
      assistedCallingEnabled
      booking={null}
      contact={contact}
      defaultScriptKind="follow_up"
      followUp={followUp}
      onComplete={onComplete}
      organization={organization}
      phones={[{ ...phoneBase, type: "mobile" }]}
      scriptPrompts={["Reference the previous conversation"]}
      timeline={[]}
      voicemailLauncherUrl="https://launcher.example.test/voicemail"
      {...overrides}
    />,
  );
  return { ...view, onComplete };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("CallWorkspace shared phone actions", () => {
  it("links a completed browser call to the existing outcome using authoritative technical timestamps", async () => {
    const { onComplete } = renderWorkspace({
      computerCalling: { enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("button", { name: "Finish computer call" });
    fireEvent.click(screen.getByRole("button", { name: "Finish computer call" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Reached Avery." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: "70000000-0000-4000-8000-000000000007",
      method: "browser_voip",
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
      endedAt: new Date("2026-09-01T10:03:15.000Z"),
    })));
  });

  it("locks phone selection while a computer call is active and preserves its session on outcome retry", async () => {
    const secondPhone = { ...phoneBase, id: "50000000-0000-4000-8000-000000000002", primary: false, number: "701-555-0101" };
    const onComplete = vi.fn().mockResolvedValue({ ok: false, error: "Try again" });
    renderWorkspace({
      computerCalling: { enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" },
      onComplete,
      phones: [{ ...phoneBase, type: "mobile" }, { ...secondPhone, type: "office" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Call from computer" }));
    await screen.findByRole("button", { name: "Simulate active computer call" });
    expect(screen.getByLabelText("Phone number")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Simulate active computer call" }));
    expect(screen.getByLabelText("Phone number")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Finish computer call" }));
    expect(screen.getByLabelText("Phone number")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Retry this outcome." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(onComplete).toHaveBeenLastCalledWith(expect.objectContaining({
      requestKey: "70000000-0000-4000-8000-000000000007",
      method: "browser_voip",
      phoneId: phoneBase.id,
    })));
  });

  it.each([
    {
      type: "mobile",
      expected: ["Call", "Leave voicemail", "Copy number"],
      absent: ["Call office", "Use extension"],
    },
    {
      type: "office",
      expected: ["Call office", "Use extension", "Copy number"],
      absent: ["Leave voicemail"],
      extension: "12",
    },
  ] as const)("shows the exact $type action labels", ({ type, expected, absent, extension }) => {
    renderWorkspace({
      phones: [{ ...phoneBase, type, extension: extension ?? null }],
    });
    for (const label of expected) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const label of absent) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("warns that an unknown number may be an office number", () => {
    renderWorkspace({ phones: [{ ...phoneBase, type: "unknown" }] });
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave voicemail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy number" })).toBeInTheDocument();
    expect(screen.getByText("May not work for office numbers.")).toBeInTheDocument();
  });

  it.each(["mobile", "alternate", "unknown"] as const)(
    "keeps Copy number available for a suppressed %s number",
    (type) => {
      renderWorkspace({ phones: [{
        ...phoneBase, type, doNotCallAt: "2026-08-13T16:00:00.000Z",
        doNotCallReason: "Requested",
      }] });
      expect(screen.getByRole("button", { name: "Copy number" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Call" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Leave voicemail" })).not.toBeInTheDocument();
    },
  );

  it("suppresses calling and voicemail actions for a Do Not Call number", () => {
    renderWorkspace({
      phones: [{
        ...phoneBase,
        type: "office",
        extension: "12",
        doNotCallAt: "2026-08-01T00:00:00.000Z",
        doNotCallReason: "Requested",
      }],
    });
    expect(screen.queryByRole("button", { name: "Call office" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use extension" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave voicemail" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy number" })).toBeInTheDocument();
  });

  it("suppresses a Do Not Call mobile number while keeping the office number callable", () => {
    const mobilePhone = {
      ...phoneBase,
      type: "mobile" as const,
      doNotCallAt: "2026-08-13T16:05:00.000Z",
      doNotCallReason: "Requested no mobile calls",
    };
    const officePhone = {
      ...phoneBase,
      id: "50000000-0000-4000-8000-000000000002",
      number: "701-555-0100",
      normalizedNumber: "7015550100",
      type: "office" as const,
      extension: "12",
      primary: false,
    };
    renderWorkspace({ phones: [mobilePhone, officePhone] });

    expect(screen.getByText("Calling is unavailable for this number.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave voicemail" })).not.toBeInTheDocument();
    expect(screen.queryByText("Last Resort")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: officePhone.id },
    });

    expect(screen.getByRole("button", { name: "Call office" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use extension" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy number" })).toBeInTheDocument();
  });
});

describe("CallWorkspace scripts, modes, and drafts", () => {
  it("switches between the approved call scripts", () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Call script"), {
      target: { value: "contract_follow_up" },
    });
    expect(screen.getByText("Confirm they received the proposal or contract")).toBeInTheDocument();
  });

  it("restores a draft for this exact call context", () => {
    const key = buildCallDraftKey({
      organizationId: organization.id,
      contactId: contact.id,
      bookingId: null,
      followUpId: followUp.id,
    });
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      requestKey: "70000000-0000-4000-8000-000000000001",
      selectedPhoneId: phoneBase.id,
      direction: "outgoing",
      method: "standard_call",
      scriptKind: "follow_up",
      note: "Restored contract note",
      disposition: "follow_up_needed",
      nextActionKind: "call",
      nextActionDate: "2026-08-15",
      lastResortConfirmed: false,
      lastResortReason: "",
      doNotCallConfirmed: false,
      doNotCallReason: "",
    }));

    renderWorkspace();

    expect(screen.getByRole("status")).toHaveTextContent("Draft restored.");
    expect(screen.getByLabelText("Call note")).toHaveValue("Restored contract note");
  });

  it("clears the draft only after confirmed completion", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "70000000-0000-4000-8000-000000000001",
    });
    const { onComplete } = renderWorkspace();
    const key = buildCallDraftKey({
      organizationId: organization.id,
      contactId: contact.id,
      bookingId: null,
      followUpId: followUp.id,
    });

    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), {
      target: { value: "Discussed the event." },
    });
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull(), { timeout: 1_000 });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("retains the draft when completion fails", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "70000000-0000-4000-8000-000000000001",
    });
    const onComplete = vi.fn().mockResolvedValue({ ok: false, error: "Try again" });
    renderWorkspace({ onComplete });
    const key = buildCallDraftKey({
      organizationId: organization.id,
      contactId: contact.id,
      bookingId: null,
      followUpId: followUp.id,
    });

    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), {
      target: { value: "Keep this note." },
    });
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull(), { timeout: 1_000 });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await screen.findByRole("alert");

    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it("uses one composition for mobile and compact modes, with compact history collapsed", () => {
    const { rerender } = renderWorkspace({ mode: "compact" });
    expect(screen.getByTestId("call-workspace")).toHaveAttribute("data-mode", "compact");
    expect(screen.getByText("Recent history").closest("details")).not.toHaveAttribute("open");

    rerender(
      <CallWorkspace
        booking={null}
        contact={contact}
        defaultScriptKind="follow_up"
        followUp={followUp}
        mode="mobile"
        onComplete={vi.fn().mockResolvedValue({ ok: true })}
        organization={organization}
        phones={[{ ...phoneBase, type: "mobile" }]}
        scriptPrompts={["Reference the previous conversation"]}
        timeline={[]}
        voicemailLauncherUrl="https://launcher.example.test/voicemail"
      />,
    );
    expect(screen.getByTestId("call-workspace")).toHaveAttribute("data-mode", "mobile");
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
  });
});


describe("CallWorkspace fix round 1 safety", () => {
  it("defaults assisted calling off unless server configuration explicitly enables it", () => {
    renderWorkspace({ assistedCallingEnabled: undefined });
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave voicemail" })).not.toBeInTheDocument();
  });

  it("resets all call state on context changes and restores only the new context draft", async () => {
    const contactB = { ...contact, id: "20000000-0000-4000-8000-000000000002", name: "Blake North" };
    const contactC = { ...contact, id: "20000000-0000-4000-8000-000000000003", name: "Casey West" };
    const followUpB = { ...followUp, id: "60000000-0000-4000-8000-000000000002" };
    const followUpC = { ...followUp, id: "60000000-0000-4000-8000-000000000003" };
    const phoneB = { ...phoneBase, id: "50000000-0000-4000-8000-000000000002", contactId: contactB.id, number: "701-555-0102", type: "mobile" as const };
    const phoneC = { ...phoneBase, id: "50000000-0000-4000-8000-000000000003", contactId: contactC.id, number: "701-555-0103", type: "mobile" as const };
    const keyA = buildCallDraftKey({ organizationId: organization.id, contactId: contact.id, bookingId: null, followUpId: followUp.id });
    const keyB = buildCallDraftKey({ organizationId: organization.id, contactId: contactB.id, bookingId: null, followUpId: followUpB.id });
    const keyC = buildCallDraftKey({ organizationId: organization.id, contactId: contactC.id, bookingId: null, followUpId: followUpC.id });
    const storedDraft = (overrides: Record<string, unknown>) => ({
      version: 1,
      savedAt: new Date().toISOString(),
      requestKey: "70000000-0000-4000-8000-000000000001",
      selectedPhoneId: phoneBase.id,
      direction: "outgoing",
      method: "standard_call",
      scriptKind: "follow_up",
      note: "Context A note",
      disposition: "interested",
      nextActionKind: "call",
      nextActionDate: "2026-08-15",
      lastResortConfirmed: true,
      lastResortReason: "Context A reason",
      doNotCallConfirmed: true,
      doNotCallReason: "Context A suppression",
      ...overrides,
    });
    localStorage.setItem(keyA, JSON.stringify(storedDraft({})));
    const { rerender, onComplete } = renderWorkspace();
    expect(screen.getByLabelText("Call note")).toHaveValue("Context A note");

    rerender(
      <CallWorkspace
        assistedCallingEnabled
        booking={null}
        contact={contactB}
        defaultScriptKind="follow_up"
        followUp={followUpB}
        onComplete={onComplete}
        organization={organization}
        phones={[phoneB]}
        scriptPrompts={["Reference the previous conversation"]}
        timeline={[]}
        voicemailLauncherUrl="https://launcher.example.test/voicemail"
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Start call note" })).toBeInTheDocument());
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(localStorage.getItem(keyB)).toBeNull();

    localStorage.setItem(keyC, JSON.stringify(storedDraft({
      requestKey: "70000000-0000-4000-8000-000000000003",
      selectedPhoneId: phoneC.id,
      note: "Context C note",
      disposition: "left_voicemail",
      nextActionKind: "",
      nextActionDate: "",
      lastResortConfirmed: false,
      lastResortReason: "",
      doNotCallConfirmed: false,
      doNotCallReason: "",
    })));
    rerender(
      <CallWorkspace
        assistedCallingEnabled
        booking={null}
        contact={contactC}
        defaultScriptKind="follow_up"
        followUp={followUpC}
        onComplete={onComplete}
        organization={organization}
        phones={[phoneC]}
        scriptPrompts={["Reference the previous conversation"]}
        timeline={[]}
        voicemailLauncherUrl="https://launcher.example.test/voicemail"
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Call note")).toHaveValue("Context C note"));
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete).toHaveBeenLastCalledWith(expect.objectContaining({
      requestKey: "70000000-0000-4000-8000-000000000003",
      contactId: contactC.id,
      followUpId: followUpC.id,
      phoneId: phoneC.id,
      disposition: "left_voicemail",
    }));
  });

  it("suppresses the selected number locally after a confirmed Do Not Call save", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "70000000-0000-4000-8000-000000000001" });
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Requested no more calls." } });
    fireEvent.change(screen.getByLabelText("Call disposition"), { target: { value: "do_not_call" } });
    fireEvent.change(screen.getByLabelText("Do Not Call reason"), { target: { value: "Requested during call" } });
    fireEvent.click(screen.getByLabelText("I confirm this selected number should be marked Do Not Call"));
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await screen.findByText("Call note saved.");
    expect(screen.queryByRole("button", { name: "Call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave voicemail" })).not.toBeInTheDocument();
  });

  it("clears Do Not Call confirmation when the selected phone changes", async () => {
    const office = { ...phoneBase, id: "50000000-0000-4000-8000-000000000002", type: "office" as const, primary: false };
    const first = renderWorkspace({ phones: [{ ...phoneBase, type: "mobile" }, office] });
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Requested suppression." } });
    fireEvent.change(screen.getByLabelText("Call disposition"), { target: { value: "do_not_call" } });
    fireEvent.change(screen.getByLabelText("Do Not Call reason"), { target: { value: "Requested" } });
    fireEvent.click(screen.getByLabelText("I confirm this selected number should be marked Do Not Call"));

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: office.id } });

    expect(screen.getByLabelText("Do Not Call reason")).toHaveValue("");
    expect(screen.getByLabelText("I confirm this selected number should be marked Do Not Call")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/confirm Do Not Call/i);
    expect(first.onComplete).not.toHaveBeenCalled();
  });

  it("does not reuse draft Do Not Call confirmation when the saved phone is missing", async () => {
    const key = buildCallDraftKey({
      organizationId: organization.id, contactId: contact.id, bookingId: null, followUpId: followUp.id,
    });
    localStorage.setItem(key, JSON.stringify({
      version: 1, savedAt: new Date().toISOString(), requestKey: "restored-request-key",
      selectedPhoneId: "missing-phone", direction: "outgoing", method: "standard_call",
      scriptKind: "follow_up", note: "Suppression draft", disposition: "do_not_call",
      nextActionKind: "", nextActionDate: "", lastResortConfirmed: false, lastResortReason: "",
      doNotCallConfirmed: true, doNotCallReason: "Requested", doNotCallPhoneId: "missing-phone",
    }));
    renderWorkspace();
    expect(await screen.findByLabelText("Call note")).toHaveValue("Suppression draft");
    expect(screen.getByLabelText("Phone number")).toHaveValue(phoneBase.id);
    expect(screen.getByLabelText("Do Not Call reason")).toHaveValue("");
    expect(screen.getByLabelText("I confirm this selected number should be marked Do Not Call")).not.toBeChecked();
  });

  it("derives untouched desktop method and selected-phone changes without mobile_log", async () => {
    const office = { ...phoneBase, id: "50000000-0000-4000-8000-000000000002", type: "office" as const, primary: false };
    const first = renderWorkspace({ phones: [{ ...phoneBase, type: "mobile" }, office] });
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Desktop note." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(first.onComplete).toHaveBeenLastCalledWith(expect.objectContaining({ method: "standard_call", entryMode: "desktop" })));

    first.unmount();
    const second = renderWorkspace({ phones: [{ ...phoneBase, type: "mobile" }, office] });
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Office note." } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: office.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(second.onComplete).toHaveBeenLastCalledWith(expect.objectContaining({ method: "office_call" })));
  });

  it("does not submit stale Do Not Call fields after a quick outcome", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "70000000-0000-4000-8000-000000000001" });
    const { onComplete } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Reached the contact." } });
    fireEvent.change(screen.getByLabelText("Call disposition"), { target: { value: "do_not_call" } });
    fireEvent.change(screen.getByLabelText("Do Not Call reason"), { target: { value: "Stale reason" } });
    fireEvent.click(screen.getByLabelText("I confirm this selected number should be marked Do Not Call"));
    fireEvent.click(screen.getByRole("button", { name: "No answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete).toHaveBeenLastCalledWith(expect.objectContaining({
      disposition: "no_answer",
      doNotCallConfirmed: false,
      doNotCallReason: null,
    }));
  });

  it("does not submit stale Last Resort fields after a quick outcome", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "70000000-0000-4000-8000-000000000001" });
    const { onComplete } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Reached the contact." } });
    fireEvent.change(screen.getByLabelText("Call disposition"), { target: { value: "move_to_last_resort" } });
    fireEvent.change(screen.getByLabelText("Last Resort reason"), { target: { value: "Stale reason" } });
    fireEvent.click(screen.getByLabelText("I confirm this organization should be moved to Last Resort"));
    fireEvent.click(screen.getByRole("button", { name: "Spoke with contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete).toHaveBeenLastCalledWith(expect.objectContaining({
      disposition: "spoke_with_contact",
      lastResortConfirmed: false,
      lastResortReason: null,
    }));
  });

  it("submits the selected phone metadata without browser-authored snapshots", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "70000000-0000-4000-8000-000000000001" });
    const { onComplete } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Discussed the event." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete).toHaveBeenLastCalledWith(expect.objectContaining({
      direction: "outgoing",
      method: "standard_call",
      phoneId: phoneBase.id,
      scriptKind: "follow_up",
    }));
    expect(onComplete.mock.calls[0]?.[0]).not.toHaveProperty("phoneNumberSnapshot");
    expect(onComplete.mock.calls[0]?.[0]).not.toHaveProperty("phoneExtensionSnapshot");
  });

  it("shows attraction totals and preserves warning severity", () => {
    renderWorkspace({
      booking: {
        id: "30000000-0000-4000-8000-000000000001",
        name: "Fall Festival",
        city: "Fargo",
        region: "ND",
        status: "interested",
        startsAt: null,
      },
      operations: {
        packageNames: ["Gold"],
        sharedAttractionTotal: 4,
        pendingRequestCount: 0,
        leg: null,
        warnings: [
          { id: "blocking", kind: "resource", severity: "blocking", message: "Blocking issue", href: "/blocking" },
          { id: "warning", kind: "route", severity: "warning", message: "Warning issue", href: "/warning" },
        ],
      },
    });

    expect(screen.getByText("1 package · 4 attractions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Blocking issue" })).toHaveClass("text-rose-700");
    expect(screen.getByRole("link", { name: "Warning issue" })).toHaveClass("text-amber-800");
  });
});
