import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceSettings: vi.fn(),
  startGoogleWorkspaceOAuth: vi.fn(),
  previewGoogleWorkspaceScope: vi.fn(),
  saveGoogleWorkspaceScope: vi.fn(),
  runGoogleWorkspaceRecentValidation: vi.fn(),
  disconnectGoogleWorkspace: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);

import { SettingsGoogleWorkspacePage } from "./SettingsGoogleWorkspacePage";

const preview = {
  labels: [
    { id: "shows", name: "Shows", rootId: "shows", rootName: "Shows" },
    {
      id: "shows-old",
      name: "Shows/Old Leads",
      rootId: "shows",
      rootName: "Shows",
    },
  ],
  calendars: [
    { id: "az", summary: "Adventure Zone Calendar", primary: false },
  ],
  missingLabelRoots: [],
  missingCalendars: [],
  excludedLabelCount: 0,
  excludedCalendarCount: 0,
};

beforeEach(() => {
  client.getGoogleWorkspaceSettings.mockResolvedValue({
    configured: true,
    connection: {
      id: "connection-id",
      email: "zone@example.com",
      status: "connected",
      grantedScopes: [],
      connectedAt: "2026-08-23T19:00:00.000Z",
      lastVerifiedAt: null,
      lastErrorCode: null,
    },
    labels: [],
    calendars: [],
  });
  client.previewGoogleWorkspaceScope.mockResolvedValue(preview);
  client.saveGoogleWorkspaceScope.mockResolvedValue({
    labels: preview.labels.filter((label) => label.id !== "shows-old"),
    calendars: preview.calendars,
  });
  client.runGoogleWorkspaceRecentValidation.mockResolvedValue({
    checkedLimit: 100,
    aiEnabled: false,
    historicalImportStarted: false,
    counts: { discovered: 0, matched: 0, needsReview: 0, ignored: 0 },
    matched: [],
    needsReview: [],
    ignored: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Google Workspace optional nested labels", () => {
  it("keeps Save enabled when a nested label is unchecked and saves the selected subset", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    fireEvent.click(await screen.findByLabelText("Shows/Old Leads"));

    const save = screen.getByRole("button", { name: "Save business scope" });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(client.saveGoogleWorkspaceScope).toHaveBeenCalledWith({
        labelIds: ["shows"],
        calendarIds: ["az"],
      }),
    );
  });

  it("still disables Save when a required root is unchecked", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    fireEvent.click(await screen.findByLabelText("Shows"));

    expect(
      screen.getByRole("button", { name: "Save business scope" }),
    ).toBeDisabled();
  });
});
