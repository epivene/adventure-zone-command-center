import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceSettings: vi.fn(),
  startGoogleWorkspaceOAuth: vi.fn(),
  previewGoogleWorkspaceScope: vi.fn(),
  saveGoogleWorkspaceScope: vi.fn(),
  disconnectGoogleWorkspace: vi.fn(),
}));

vi.mock(
  "@/features/google-workspace/google-workspace-client",
  () => client,
);

import { SettingsGoogleWorkspacePage } from "./SettingsGoogleWorkspacePage";

beforeEach(() => {
  client.getGoogleWorkspaceSettings.mockResolvedValue({
    configured: true,
    connection: null,
    labels: [],
    calendars: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/settings/google-workspace");
});

describe("SettingsGoogleWorkspacePage OAuth return status", () => {
  it("explains when the Google consent screen was cancelled", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/google-workspace?googleError=GOOGLE_WORKSPACE_OAUTH_ACCESS_DENIED",
    );

    render(<SettingsGoogleWorkspacePage />);

    expect(
      await screen.findByText(
        "Google connection was cancelled. Nothing was connected or changed.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      "GOOGLE_WORKSPACE_OAUTH_ACCESS_DENIED",
    );
  });

  it("confirms a successful return without trusting arbitrary query text", async () => {
    client.getGoogleWorkspaceSettings.mockResolvedValue({
      configured: true,
      connection: {
        id: "connection-id",
        email: "zone.pirate.warrior@gmail.com",
        status: "connected",
        grantedScopes: [],
        connectedAt: "2026-08-22T21:00:00.000Z",
        lastVerifiedAt: "2026-08-22T21:00:00.000Z",
        lastErrorCode: null,
      },
      labels: [],
      calendars: [],
    });
    window.history.replaceState(
      {},
      "",
      "/settings/google-workspace?connected=1&googleError=made-up-private-text",
    );

    render(<SettingsGoogleWorkspacePage />);

    expect(
      await screen.findByText("Google account connected in read-only mode."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("made-up-private-text");
  });
});
