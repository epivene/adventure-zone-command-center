import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
}));
vi.mock("@/actions/calls", () => ({ completeCallAction: vi.fn() }));
vi.mock("@/components/calls/call-workspace", () => ({
  CallWorkspace: ({ assistedCallingEnabled, voicemailLauncherUrl }: {
    assistedCallingEnabled: boolean;
    voicemailLauncherUrl: string | null;
  }) => (
    <p>
      workspace:{String(assistedCallingEnabled)}:{voicemailLauncherUrl ?? "none"}
    </p>
  ),
}));
vi.mock("wouter", () => ({ useSearch: () => "?contactId=20000000-0000-4000-8000-000000000001" }));

import CallWorkspacePage from "./CallWorkspacePage";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("CallWorkspacePage configuration fallback", () => {
  it("fails closed without rendering assisted workspace when config loading fails", async () => {
    apiGet.mockImplementation((path: string) => {
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
    apiGet.mockImplementation((path: string) => path === "/calls/config"
      ? Promise.resolve({ assistedCallingEnabled: true, voicemailLauncherUrl: null })
      : Promise.resolve({ context: {}, timeline: [], phones: [] }));
    render(<CallWorkspacePage />);
    expect(await screen.findByText("workspace:true:none")).toBeInTheDocument();
  });
});
