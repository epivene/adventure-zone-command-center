import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const completeCallAction = vi.hoisted(() => vi.fn());
const setLocation = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/actions/calls", () => ({ completeCallAction }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
}));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/calls/log", setLocation],
    useSearch: () => "",
  };
});

import MobileCallLogPage from "./MobileCallLogPage";

const contactId = "20000000-0000-4000-8000-000000000001";
const primaryPhoneId = "30000000-0000-4000-8000-000000000001";
const alternatePhoneId = "30000000-0000-4000-8000-000000000002";

function workspace(contactName = "Sarah Miller") {
  return {
    assistedCallingEnabled: true,
    context: {
      organization: { id: "organization-1", name: "Prairie Days", lastResort: false, lastResortReason: null },
      contact: {
        id: contactId,
        firstName: contactName.split(" ")[0],
        lastName: contactName.split(" ")[1],
        phone: "303-555-0100",
        email: "sarah@example.com",
        city: "Denver",
        region: "CO",
      },
      booking: null,
      followUp: null,
    },
    activityParent: { contactId },
    contextSummary: null,
    defaultScriptKind: "incoming_inquiry",
    operations: null,
    phones: [
      {
        id: primaryPhoneId,
        contactId,
        number: "303-555-0100",
        normalizedNumber: "+13035550100",
        type: "mobile",
        extension: null,
        label: "Mobile",
        primary: true,
        source: "manual",
        doNotCallAt: null,
        doNotCallReason: null,
      },
      {
        id: alternatePhoneId,
        contactId,
        number: "720-555-0199",
        normalizedNumber: "+17205550199",
        type: "alternate",
        extension: null,
        label: "Alternate",
        primary: false,
        source: "manual",
        doNotCallAt: null,
        doNotCallReason: null,
      },
    ],
    scriptPrompts: [],
    timeline: [],
  };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  completeCallAction.mockReset();
  setLocation.mockReset();
  localStorage.clear();
});

describe("MobileCallLogPage", () => {
  it("shows a legacy fallback and never loads assisted entry when the flag is off", async () => {
    apiGet.mockImplementation((path: string) => path === "/calls/config"
      ? Promise.resolve({ assistedCallingEnabled: false, voicemailLauncherUrl: null })
      : Promise.reject(new Error(`Unexpected assisted request: ${path}`)));
    render(<MobileCallLogPage contactId={contactId} />);
    expect(await screen.findByText("Assisted calling is not enabled.")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Log call" })).not.toBeInTheDocument();
  });

  it("finds a caller and opens the mobile logging form", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/calls/caller-finder")) {
        return Promise.resolve({
          exact: { kind: "none" },
          canCreate: false,
          suggestions: [{
            contactId,
            name: "Sarah Miller",
            organizationName: "Prairie Days",
            city: "Denver",
            region: "CO",
            bookingStatus: null,
            routeLegName: null,
            lastContactedAt: null,
            reasons: ["Organization or event"],
            score: 100,
          }],
        });
      }
      if (path.startsWith("/calls/workspace")) return Promise.resolve(workspace());
      if (path === "/calls/config") return Promise.resolve({ assistedCallingEnabled: true, voicemailLauncherUrl: null });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    render(<MobileCallLogPage />);
    fireEvent.change(await screen.findByLabelText("Find caller"), { target: { value: "Prairie Days" } });
    fireEvent.click(await screen.findByRole("button", { name: /Sarah Miller/i }));

    expect(await screen.findByRole("heading", { name: "Log call" })).toBeVisible();
    expect(screen.getByLabelText("Call note")).toBeVisible();
  });

  it("persists a selected caller and existing context in the mobile log URL", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith("/calls/caller-finder")) {
        return Promise.resolve({
          exact: { kind: "none" },
          canCreate: false,
          suggestions: [{
            contactId,
            name: "Sarah Miller",
            organizationName: "Prairie Days",
            city: "Denver",
            region: "CO",
            bookingStatus: null,
            routeLegName: null,
            lastContactedAt: null,
            reasons: ["Organization or event"],
            score: 100,
          }],
        });
      }
      if (path.startsWith("/calls/workspace")) return Promise.resolve(workspace());
      if (path === "/calls/config") return Promise.resolve({ assistedCallingEnabled: true, voicemailLauncherUrl: null });
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    render(<MobileCallLogPage organizationId="organization-1" bookingId="booking-1" />);
    fireEvent.change(await screen.findByLabelText("Find caller"), { target: { value: "Prairie Days" } });
    fireEvent.click(await screen.findByRole("button", { name: /Sarah Miller/i }));

    expect(setLocation).toHaveBeenCalledWith(
      `/calls/log?contactId=${contactId}&organizationId=organization-1&bookingId=booking-1`,
      { replace: true },
    );
  });

  it("defaults a mobile log to incoming without attempting audio capture", async () => {
    apiGet.mockResolvedValue(workspace());

    render(<MobileCallLogPage contactId={contactId} />);

    expect(await screen.findByLabelText("Direction")).toHaveValue("incoming");
    expect(screen.queryByText(/record|transcrib/i)).not.toBeInTheDocument();
  });

  it("saves through the shared call API with a stable request key and mobile method", async () => {
    apiGet.mockResolvedValue(workspace());
    completeCallAction.mockResolvedValue({ ok: true });

    render(<MobileCallLogPage contactId={contactId} />);
    fireEvent.change(await screen.findByLabelText("Call note"), { target: { value: "Returned Sarah's call." } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "outgoing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(completeCallAction).toHaveBeenCalledTimes(1));
    expect(completeCallAction).toHaveBeenCalledWith(expect.objectContaining({
      contactId,
      direction: "outgoing",
      entryMode: "mobile",
      method: "mobile_log",
      scriptKind: "first_outreach",
      note: "Returned Sarah's call.",
      requestKey: expect.any(String),
    }));
  });

  it("normalizes a restored incoming draft to the incoming inquiry script before saving", async () => {
    apiGet.mockResolvedValue(workspace());
    completeCallAction.mockResolvedValue({ ok: true });
    localStorage.setItem(
      `assisted-call-draft:v1:organization-1:${contactId}:none:none`,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        requestKey: "restored-request-key",
        selectedPhoneId: primaryPhoneId,
        direction: "incoming",
        method: "mobile_log",
        scriptKind: "first_outreach",
        note: "Restored incoming call.",
        disposition: "spoke_with_contact",
        nextActionKind: "",
        nextActionDate: "",
        lastResortConfirmed: false,
        lastResortReason: "",
        doNotCallConfirmed: false,
        doNotCallReason: "",
        doNotCallPhoneId: null,
      }),
    );

    render(<MobileCallLogPage contactId={contactId} />);
    expect(await screen.findByText("Draft restored.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(completeCallAction).toHaveBeenCalledTimes(1));
    expect(completeCallAction).toHaveBeenCalledWith(expect.objectContaining({
      direction: "incoming",
      scriptKind: "incoming_inquiry",
    }));
  });

  it("discards a mobile draft into a fresh immediately usable log", async () => {
    apiGet.mockResolvedValue(workspace());
    completeCallAction.mockResolvedValue({ ok: true });
    render(<MobileCallLogPage contactId={contactId} />);

    fireEvent.change(await screen.findByLabelText("Call note"), { target: { value: "Discard this note." } });
    const draftKey = await waitFor(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("assisted-call-draft:"));
      expect(key).toBeTruthy();
      return key!;
    });
    const discardedRequestKey = JSON.parse(localStorage.getItem(draftKey)!).requestKey;

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

    expect(screen.getByLabelText("Call note")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Start call note" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(completeCallAction).toHaveBeenCalledTimes(1));
    expect(completeCallAction.mock.calls[0][0].requestKey).not.toBe(discardedRequestKey);
  });

  it("resets every draft-controlled choice to fresh mobile defaults when discarded", async () => {
    apiGet.mockResolvedValue(workspace());
    completeCallAction.mockResolvedValue({ ok: true });
    localStorage.setItem(
      `assisted-call-draft:v1:organization-1:${contactId}:none:none`,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        requestKey: "restored-request-key",
        selectedPhoneId: alternatePhoneId,
        direction: "outgoing",
        method: "office_call",
        scriptKind: "first_outreach",
        note: "Discard restored choices.",
        disposition: "no_answer",
        nextActionKind: "",
        nextActionDate: "",
        lastResortConfirmed: false,
        lastResortReason: "",
        doNotCallConfirmed: false,
        doNotCallReason: "",
      }),
    );

    render(<MobileCallLogPage contactId={contactId} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Direction")).toHaveValue("outgoing");
      expect(screen.getByLabelText("Phone number")).toHaveValue(alternatePhoneId);
    });
    const discardedAt = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

    expect(screen.getByLabelText("Direction")).toHaveValue("incoming");
    expect(screen.getByLabelText("Phone number")).toHaveValue(primaryPhoneId);
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));

    await waitFor(() => expect(completeCallAction).toHaveBeenCalledTimes(1));
    expect(completeCallAction).toHaveBeenCalledWith(expect.objectContaining({
      direction: "incoming",
      phoneId: primaryPhoneId,
      method: "mobile_log",
      scriptKind: "incoming_inquiry",
      requestKey: expect.not.stringMatching("restored-request-key"),
      startedAt: expect.any(Date),
    }));
    expect(completeCallAction.mock.calls[0][0].startedAt.getTime())
      .toBeGreaterThanOrEqual(discardedAt);
  });
});
