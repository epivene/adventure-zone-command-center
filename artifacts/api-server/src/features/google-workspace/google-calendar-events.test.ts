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
});