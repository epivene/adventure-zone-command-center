import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  search: "?contactId=20000000-0000-4000-8000-000000000001",
  setLocation: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
}));
vi.mock("@/actions/calls", () => ({ completeCallAction: vi.fn() }));
vi.mock("@/components/calls/call-workspace", () => ({
  CallWorkspace: ({ assistedCallingEnabled, voicemailLauncherUrl, computerCalling }: {
    assistedCallingEnabled: boolean;
    voicemailLauncherUrl: string | null;
    computerCalling?: { enabled: boolean; reason: string; callerIdDisplay: string | null };
  }) => (
    <>
      <p>workspace:{String(assistedCallingEnabled)}:{voicemailLauncherUrl ?? "none"}</p>
      <p data-testid="computer-calling-capability">{computerCalling ? `${computerCalling.reason}:${computerCalling.callerIdDisplay ?? "none"}` : "absent"}</p>
    </>
  ),
}));
vi.mock("@/components/calls/caller-finder", () => ({
  CallerFinder: ({ onSelect }: { onSelect: (contactId: string) => void }) => (
    <button onClick={() => onSelect("30000000-0000-4000-8000-000000000001")} type="button">
      Choose caller
    </button>
  ),
}));
vi.mock("wouter", () => ({
  useSearch: () => mocks.search,
  useLocation: () => ["/calls/workspace", mocks.setLocation],
}));

import CallWorkspacePage from "./CallWorkspacePage";

afterEach(() => {
  cleanup();
  mocks.apiGet.mockReset();
  mocks.setLocation.mockReset();
  mocks.search = "?contactId=20000000-0000-4000-8000-000000000001";
});

describe("CallWorkspacePage configuration fallback", () => {
  it("fails closed without rendering assisted workspace when config loading fails", async () => {
    mocks.apiGet.mockImplementation((path: string) => {
      if (path === "/calls/config") return Promise.reject(new Error("config unavailable"));
      return Promise.resolve({
        context: {
          organization: null,
          booking: null,
          followUp: null,
          contact: {
            id: "20000000-0000-4000-8000-000000000001",
            firstName: "Avery",
            lastName: "Lee",
          },
        },
        timeline: [],
        phones: [],
        defaultScriptKind: "first_outreach",
        scriptPrompts: [],
      });
    });

    render(<CallWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText("Assisted calling is not enabled.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^workspace:/)).not.toBeInTheDocument();
  });

  it("renders the workspace only when the shared server flag is enabled", async () => {
    mocks.apiGet.mockImplementation((path: string) => path === "/calls/config"
      ? Promise.resolve({ assistedCallingEnabled: true, voicemailLauncherUrl: null })
      : Promise.resolve({ context: {}, timeline: [], phones: [] }));
    render(<CallWorkspacePage />);
    expect(await screen.findByText("workspace:true:none")).toBeInTheDocument();
  });

  it("passes the nested computer-calling capability through without exposing server-only configuration", async () => {
    mocks.apiGet.mockImplementation((path: string) => path === "/calls/config"
      ? Promise.resolve({
        assistedCallingEnabled: true,
        voicemailLauncherUrl: null,
        computerCalling: { enabled: true, reason: "available", callerIdDisplay: "(701) 555-0100" },
      })
      : Promise.resolve({ context: {}, timeline: [], phones: [] }));

    render(<CallWorkspacePage />);

    expect(await screen.findByTestId("computer-calling-capability")).toHaveTextContent("available:(701) 555-0100");
  });

  it("opens a caller finder when Calls is opened without a selected record", async () => {
    mocks.search = "";
    mocks.apiGet.mockResolvedValue({ assistedCallingEnabled: true, voicemailLauncherUrl: null });

    render(<CallWorkspacePage />);

    const choose = await screen.findByRole("button", { name: "Choose caller" });
    expect(mocks.apiGet).toHaveBeenCalledWith("/calls/config");
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/calls/workspace?");

    fireEvent.click(choose);
    expect(mocks.setLocation).toHaveBeenCalledWith(
      "/calls/workspace?contactId=30000000-0000-4000-8000-000000000001",
    );
  });
});
