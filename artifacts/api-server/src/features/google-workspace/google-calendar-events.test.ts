import { describe, expect, it } from "vitest";
import { createGoogleWorkspaceReadClient } from "./google-api-client";

const environment = { clientId: "client-id", clientSecret: "secret", redirectUri: "https://api.example.com/callback", appOrigin: "https://app.example.com", tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 3)) };

describe("GoogleWorkspaceReadClient calendar events", () => {
  it("paginates selected calendars inside the requested window and ignores cancelled events", async () => {
    const urls: URL[] = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) => {
        const url = new URL(String(input)); urls.push(url);
        if (url.hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
        if (url.searchParams.get("pageToken") === "next") return new Response(JSON.stringify({ items: [{ id: "cancelled", status: "cancelled" }] }));
        return new Response(JSON.stringify({ timeZone: "America/Chicago", nextPageToken: "next", items: [{
          id: "event-1", iCalUID: "ical-1", summary: "1 Foam Party", start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z",
        }] }));
      },
    });
    await expect(client.listCalendarEvents?.({
      calendarIds: ["zone-a", "zone-b"],
      timeMin: "2026-09-01T00:00:00.000Z",
      timeMax: "2026-10-01T00:00:00.000Z",
    })).resolves.toEqual([{
      calendarId: "zone-a", calendarTimeZone: "America/Chicago", id: "event-1", iCalUid: "ical-1", summary: "1 Foam Party", description: "",
      start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z", recurringEventId: null, originalStartTime: null,
    }, {
      calendarId: "zone-b", calendarTimeZone: "America/Chicago", id: "event-1", iCalUid: "ical-1", summary: "1 Foam Party", description: "",
      start: { date: "2026-09-10" }, end: { date: "2026-09-12" }, updated: "2026-08-25T12:00:00Z", recurringEventId: null, originalStartTime: null,
    }]);
    const eventUrls = urls.filter((url) => url.pathname.includes("/events"));
    expect(eventUrls).toHaveLength(4);
    expect(eventUrls.every((url) => url.searchParams.get("timeMin") === "2026-09-01T00:00:00.000Z" && url.searchParams.get("timeMax") === "2026-10-01T00:00:00.000Z")).toBe(true);
  });
  it("rejects malformed original instance times and Calendar response zones", async () => {
    for (const payload of [
      { timeZone: "Mars/Olympus", items: [] },
      { timeZone: "America/Chicago", items: [{ id: "event-1", start: { date: "2026-09-10" }, end: { date: "2026-09-11" }, originalStartTime: { date: "2026-99-99" } }] },
    ]) {
      const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh-token", fetcher: async (input) => {
        if (new URL(String(input)).hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
        return new Response(JSON.stringify(payload));
      } });
      await expect(client.listCalendarEvents?.({ calendarIds: ["zone-a"], timeMin: "2026-09-01T00:00:00.000Z", timeMax: "2026-10-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID" });
    }
  });
  it.each([
    ["invalid JSON", () => new Response("not-json")],
    ["empty object", () => new Response(JSON.stringify({}))],
    ["non-array items", () => new Response(JSON.stringify({ timeZone: "America/Chicago", items: {} }))],
    ["missing ID on active event", () => new Response(JSON.stringify({ timeZone: "America/Chicago", items: [{ start: { date: "2026-09-10" }, end: { date: "2026-09-11" } }] }))],
  ])("rejects %s Calendar event-list evidence", async (_name, response) => {
    const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh-token", fetcher: async (input) => {
      if (new URL(String(input)).hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      return response();
    } });
    await expect(client.listCalendarEvents?.({ calendarIds: ["zone-a"], timeMin: "2026-09-01T00:00:00.000Z", timeMax: "2026-10-01T00:00:00.000Z" }))
      .rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID" });
  });
  it("rejects invalid pagination tokens and event evidence timestamps", async () => {
    for (const payload of [
      { timeZone: "America/Chicago", items: [], nextPageToken: 42 },
      { timeZone: "America/Chicago", items: [{ id: "event-1", updated: "not-a-timestamp", start: { date: "2026-09-10" }, end: { date: "2026-09-11" } }] },
    ]) {
      const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "refresh-token", fetcher: async (input) => new URL(String(input)).hostname === "oauth2.googleapis.com" ? new Response(JSON.stringify({ access_token: "token", expires_in: 3600 })) : new Response(JSON.stringify(payload)) });
      await expect(client.listCalendarEvents?.({ calendarIds: ["zone-a"], timeMin: "2026-09-01T00:00:00.000Z", timeMax: "2026-10-01T00:00:00.000Z" }))
        .rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_CALENDAR_EVENT_RESPONSE_INVALID" });
    }
  });
});
