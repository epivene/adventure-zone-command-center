import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceSettings: vi.fn(),
  startGoogleWorkspaceOAuth: vi.fn(),
  previewGoogleWorkspaceScope: vi.fn(),
  saveGoogleWorkspaceScope: vi.fn(),
  disconnectGoogleWorkspace: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => client);

import { SettingsGoogleWorkspacePage } from "./SettingsGoogleWorkspacePage";

const preview = {
  labels: [
    { id: "receipt", name: "Receipt", rootId: "receipt", rootName: "Receipt" },
    {
      id: "receipt-old",
      name: "Receipt/Old Vendor Receipts",
      rootId: "receipt",
      rootName: "Receipt",
    },
    { id: "SPAM", name: "SPAM", rootId: "SPAM", rootName: "Spam" },
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
    labels: preview.labels.filter((label) => label.id !== "receipt-old"),
    calendars: preview.calendars,
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
    fireEvent.click(await screen.findByLabelText("Receipt/Old Vendor Receipts"));

    const save = screen.getByRole("button", { name: "Save business scope" });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(client.saveGoogleWorkspaceScope).toHaveBeenCalledWith({
        labelIds: ["receipt", "SPAM"],
        calendarIds: ["az"],
      }),
    );
  });

  it("still disables Save when a required root is unchecked", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    fireEvent.click(await screen.findByLabelText("Receipt"));

    expect(
      screen.getByRole("button", { name: "Save business scope" }),
    ).toBeDisabled();
  });
});
