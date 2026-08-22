import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const savedSettings = {
  configured: true,
  connection: {
    id: "connection-id",
    email: "zone.pirate.warrior@gmail.com",
    status: "connected" as const,
    grantedScopes: ["gmail.readonly", "calendar.readonly", "drive.readonly"],
    connectedAt: "2026-08-22T18:00:00.000Z",
    lastVerifiedAt: "2026-08-22T18:00:00.000Z",
    lastErrorCode: null,
  },
  labels: [
    { id: "shows", name: "Shows", rootId: "shows", rootName: "Shows" },
  ],
  calendars: [
    { id: "az", summary: "Adventure Zone Calendar", primary: false },
  ],
};

const preview = {
  labels: [
    { id: "shows", name: "Shows", rootId: "shows", rootName: "Shows" },
    {
      id: "shows-2026",
      name: "Shows/2026",
      rootId: "shows",
      rootName: "Shows",
    },
    {
      id: "receipts",
      name: "Receipts",
      rootId: "receipts",
      rootName: "Receipts",
    },
  ],
  calendars: [
    { id: "az", summary: "Adventure Zone Calendar", primary: false },
    {
      id: "zone.pirate.warrior@gmail.com",
      summary: "Zone Pirate Warrior",
      primary: true,
    },
  ],
  missingLabelRoots: [],
  missingCalendars: [],
  excludedLabelCount: 4,
  excludedCalendarCount: 1,
};

beforeEach(() => {
  client.getGoogleWorkspaceSettings.mockResolvedValue(savedSettings);
  client.startGoogleWorkspaceOAuth.mockResolvedValue({
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
  });
  client.previewGoogleWorkspaceScope.mockResolvedValue(preview);
  client.saveGoogleWorkspaceScope.mockResolvedValue({
    labels: preview.labels,
    calendars: preview.calendars,
  });
  client.disconnectGoogleWorkspace.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsGoogleWorkspacePage", () => {
  it("shows the connected account, read-only guarantee, and saved business scope", async () => {
    render(<SettingsGoogleWorkspacePage />);

    expect(
      await screen.findByRole("heading", { name: "Google Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("zone.pirate.warrior@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(/Gmail and Google Calendar will not be changed/i)).toBeInTheDocument();
    expect(screen.getByText("Shows")).toBeInTheDocument();
    expect(screen.getByText("Adventure Zone Calendar")).toBeInTheDocument();
    expect(screen.getByText(/Historical syncing is not enabled yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start backfill/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("client-secret");
    expect(document.body.textContent).not.toContain("refresh-token");
  });

  it("starts the Google authorization flow through an injected browser navigation", async () => {
    client.getGoogleWorkspaceSettings.mockResolvedValue({
      configured: true,
      connection: null,
      labels: [],
      calendars: [],
    });
    const openAuthorizationUrl = vi.fn();
    render(
      <SettingsGoogleWorkspacePage
        openAuthorizationUrl={openAuthorizationUrl}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Google account" }),
    );

    await waitFor(() =>
      expect(openAuthorizationUrl).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?state=test",
      ),
    );
  });

  it("previews and saves every approved business source", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    expect(await screen.findByLabelText("Shows/2026")).toBeChecked();
    expect(screen.getByLabelText("Receipts")).toBeChecked();
    expect(screen.getByLabelText("Zone Pirate Warrior")).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save business scope" }));

    await waitFor(() =>
      expect(client.saveGoogleWorkspaceScope).toHaveBeenCalledWith({
        labelIds: ["shows", "shows-2026", "receipts"],
        calendarIds: ["az", "zone.pirate.warrior@gmail.com"],
      }),
    );
    expect(await screen.findByText("Business scope saved.")).toBeInTheDocument();
  });

  it("blocks saving when an approved business source is unchecked", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    fireEvent.click(await screen.findByLabelText("Receipts"));

    expect(
      screen.getByText(/All approved business labels and calendars must stay selected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save business scope" }),
    ).toBeDisabled();
    expect(client.saveGoogleWorkspaceScope).not.toHaveBeenCalled();
  });

  it("blocks saving while an expected business source is missing", async () => {
    client.previewGoogleWorkspaceScope.mockResolvedValue({
      ...preview,
      missingLabelRoots: ["Associations"],
    });
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );

    expect(await screen.findByText("Associations")).toBeInTheDocument();
    expect(
      screen.getByText(/Resolve every missing or ambiguous business source/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save business scope" }),
    ).toBeDisabled();
    expect(client.saveGoogleWorkspaceScope).not.toHaveBeenCalled();
  });

  it("uses a dark-mode-aware error surface", async () => {
    client.getGoogleWorkspaceSettings.mockRejectedValue(
      new Error("GOOGLE_WORKSPACE_SETTINGS_LOAD_FAILED"),
    );
    render(<SettingsGoogleWorkspacePage />);

    const alert = await screen.findByRole("alert");
    expect(alert.className).toContain("dark:bg-rose-950/40");
    expect(alert.className).toContain("dark:border-rose-900");
  });

  it("requires confirmation before disconnecting", async () => {
    const confirmDisconnect = vi.fn(() => false);
    render(
      <SettingsGoogleWorkspacePage confirmDisconnect={confirmDisconnect} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect Google account" }),
    );
    expect(confirmDisconnect).toHaveBeenCalledOnce();
    expect(client.disconnectGoogleWorkspace).not.toHaveBeenCalled();
  });

  it("shows a safe server-configuration message without exposing secret fields", async () => {
    client.getGoogleWorkspaceSettings.mockResolvedValue({
      configured: false,
      connection: null,
      labels: [],
      calendars: [],
    });
    render(<SettingsGoogleWorkspacePage />);

    expect(
      await screen.findByText(/Google Workspace is not configured on the server/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google account" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("GOOGLE_WORKSPACE_CLIENT_SECRET");
    expect(document.body.textContent).not.toContain("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY");
  });
});
