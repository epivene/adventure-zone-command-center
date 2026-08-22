import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiFetch }));

import {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceSettings,
  previewGoogleWorkspaceScope,
  saveGoogleWorkspaceScope,
  startGoogleWorkspaceOAuth,
} from "./google-workspace-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    headers: { "content-type": "application/json" },
  });
}

describe("Google Workspace frontend client", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("loads owner settings", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ configured: false, connection: null, labels: [], calendars: [] }));

    await expect(getGoogleWorkspaceSettings()).resolves.toEqual({
      configured: false,
      connection: null,
      labels: [],
      calendars: [],
    });
    expect(apiFetch).toHaveBeenCalledWith("/google-workspace/settings");
  });

  it("starts OAuth and previews business scope with explicit POST bodies", async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ authorizationUrl: "https://accounts.google.com/" }))
      .mockResolvedValueOnce(jsonResponse({ labels: [], calendars: [], missingLabelRoots: [], missingCalendars: [], excludedLabelCount: 5, excludedCalendarCount: 2 }));

    await expect(startGoogleWorkspaceOAuth()).resolves.toEqual({
      authorizationUrl: "https://accounts.google.com/",
    });
    await previewGoogleWorkspaceScope();

    expect(apiFetch).toHaveBeenNthCalledWith(1, "/google-workspace/oauth/start", {
      method: "POST",
      body: "{}",
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/google-workspace/scope/preview", {
      method: "POST",
      body: "{}",
    });
  });

  it("saves only selected Google IDs and disconnects explicitly", async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ labels: [], calendars: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await saveGoogleWorkspaceScope({
      labelIds: ["shows", "shows-2026"],
      calendarIds: ["az"],
    });
    await disconnectGoogleWorkspace();

    expect(apiFetch).toHaveBeenNthCalledWith(1, "/google-workspace/scope", {
      method: "PUT",
      body: JSON.stringify({
        labelIds: ["shows", "shows-2026"],
        calendarIds: ["az"],
      }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/google-workspace/disconnect", {
      method: "POST",
      body: "{}",
    });
  });

  it("surfaces the server safe error code", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ error: "GOOGLE_WORKSPACE_NOT_CONFIGURED" }, 503),
    );

    await expect(startGoogleWorkspaceOAuth()).rejects.toThrow(
      "GOOGLE_WORKSPACE_NOT_CONFIGURED",
    );
  });
});
