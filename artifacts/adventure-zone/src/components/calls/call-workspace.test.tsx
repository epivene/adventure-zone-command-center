import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCallDraftKey } from "@/features/calls/call-draft";

vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: () => <p>Timeline content</p>,
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
  it.each([
    {
      type: "mobile",
      expected: ["Call", "Leave voicemail"],
      absent: ["Call office", "Use extension", "Copy number"],
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
    expect(screen.getByText("May not work for office numbers.")).toBeInTheDocument();
  });

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
