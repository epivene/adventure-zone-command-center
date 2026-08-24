import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getGoogleWorkspaceSettings: vi.fn(),
  startGoogleWorkspaceOAuth: vi.fn(),
  previewGoogleWorkspaceScope: vi.fn(),
  saveGoogleWorkspaceScope: vi.fn(),
  runGoogleWorkspaceRecentValidation: vi.fn(),
  decideGoogleWorkspaceValidationSample: vi.fn(),
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
      id: "shows-old",
      name: "Shows/Old vendor",
      rootId: "shows",
      rootName: "Shows",
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

const validation = {
  checkedLimit: 100,
  aiEnabled: false as const,
  historicalImportStarted: false as const,
  validationStatus: "ready_for_review" as const,
  counts: { discovered: 1, matched: 1, needsReview: 0, ignored: 0 },
  matched: [
    {
      id: "m1",
      threadId: "t1",
      subject: "County Fair contract",
      from: "booking@fair.org",
      to: "zone@example.com",
      date: "",
      internalDateMs: 1,
      labelIds: ["INBOX"],
      labels: [{ id: "INBOX", name: "INBOX", type: "system" as const }],
      hasAttachments: false,
      evidenceCodes: ["exact_contact_email", "contact_active_organization"],
      candidates: [{ id: "c1", name: "Fair Office", kind: "contact" as const }],
      matchedContact: { id: "c1", name: "Fair Office" },
      resolvedOrganization: { id: "org-1", name: "County Fair" },
      organizationCandidates: [{ id: "org-1", name: "County Fair" }],
    },
  ],
  needsReview: [],
  ignored: [],
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
  client.runGoogleWorkspaceRecentValidation.mockResolvedValue(validation);
  client.decideGoogleWorkspaceValidationSample.mockResolvedValue({
    validationStatus: "approved",
    historicalImportStarted: false,
  });
  client.disconnectGoogleWorkspace.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsGoogleWorkspacePage", () => {
  it("shows the connected account, read-only guarantee, saved business scope, and recent check control", async () => {
    render(<SettingsGoogleWorkspacePage />);

    expect(
      await screen.findByRole("heading", { name: "Google Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("zone.pirate.warrior@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(/Gmail and Google Calendar will not be changed/i)).toBeInTheDocument();
    expect(screen.getByText("Shows")).toBeInTheDocument();
    expect(screen.getByText("Adventure Zone Calendar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run recent email check" })).toBeInTheDocument();
    expect(screen.getByText(/Historical syncing is still disabled/i)).toBeInTheDocument();
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

  it("allows optional nested business labels to be unchecked while saving the required roots and calendars", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    fireEvent.click(await screen.findByLabelText("Shows/Old vendor"));

    expect(screen.getByRole("button", { name: "Save business scope" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save business scope" }));

    await waitFor(() =>
      expect(client.saveGoogleWorkspaceScope).toHaveBeenCalledWith({
        labelIds: ["shows", "shows-2026"],
        calendarIds: ["az", "zone.pirate.warrior@gmail.com"],
      }),
    );
  });

  it("blocks saving when a required business root is unchecked", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview business scope" }),
    );
    fireEvent.click(await screen.findByLabelText("Shows"));

    expect(
      screen.getByText(/Keep the main business folders and all approved calendars selected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save business scope" }),
    ).toBeDisabled();
  });

  it("runs the bounded recent Gmail check and displays contact and resolved profile evidence", async () => {
    render(<SettingsGoogleWorkspacePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Run recent email check" }),
    );

    await waitFor(() =>
      expect(client.runGoogleWorkspaceRecentValidation).toHaveBeenCalledWith(100),
    );
    expect(await screen.findByText("County Fair contract")).toBeInTheDocument();
    expect(screen.getByText("Exact contact email")).toBeInTheDocument();
    expect(screen.getByText("Matched contact: Fair Office")).toBeInTheDocument();
    expect(screen.getByText("Profile: County Fair")).toBeInTheDocument();
    expect(screen.getByText(/does not start the historical import/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve sample" })).toBeInTheDocument();
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