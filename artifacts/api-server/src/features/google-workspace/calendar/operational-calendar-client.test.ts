import { describe, expect, it, vi } from "vitest";

import { createOperationalCalendarClient } from "./operational-calendar-client";

const environment = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://app.example.com/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: Buffer.alloc(32, 1).toString("base64"),
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const event = {
  summary: "MIKEY Blanding City Fall Festival - Blanding UT (Zone)",
  description: "EVENT DATES: Saturday, September 12th",
  startDate: "2026-09-10",
  endDateExclusive: "2026-09-14",
};

describe("operational calendar client", () => {
  it("creates a calendar event using the reserved all-day block", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({
        id: "google-1",
        etag: '"etag-1"',
        summary: event.summary,
        description: event.description,
        start: { date: event.startDate },
        end: { date: event.endDateExclusive },
        updated: "2026-08-28T00:00:00Z",
        status: "confirmed",
      }));
    const client = createOperationalCalendarClient({ environment, refreshToken: "refresh", fetcher });
    const created = await client.createEvent("theadventurezone12@gmail.com", event);
    expect(created.id).toBe("google-1");
    const request = fetcher.mock.calls[1]!;
    expect(request[0]).toContain("theadventurezone12%40gmail.com/events");
    expect(request[1]?.method).toBe("POST");
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      summary: event.summary,
      start: { date: "2026-09-10" },
      end: { date: "2026-09-14" },
    });
  });

  it("uses If-Match on updates so manual Google edits cause a conflict", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({}, 412));
    const client = createOperationalCalendarClient({ environment, refreshToken: "refresh", fetcher });
    await expect(client.updateEvent({
      calendarId: "theadventurezone12@gmail.com",
      eventId: "google-1",
      event,
      etag: '"old-etag"',
    })).rejects.toMatchObject({ code: "GOOGLE_OPERATIONAL_CALENDAR_CONFLICT" });
    const headers = new Headers(fetcher.mock.calls[1]![1]?.headers);
    expect(headers.get("if-match")).toBe('"old-etag"');
  });

  it("returns null when a linked Google event was deleted", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response({}, 404));
    const client = createOperationalCalendarClient({ environment, refreshToken: "refresh", fetcher });
    await expect(client.getEvent("theadventurezone12@gmail.com", "missing")).resolves.toBeNull();
  });

  it("rejects invalid reserved date windows before writing", async () => {
    const fetcher = vi.fn();
    const client = createOperationalCalendarClient({ environment, refreshToken: "refresh", fetcher });
    await expect(client.createEvent("theadventurezone12@gmail.com", {
      ...event,
      startDate: "2026-09-14",
      endDateExclusive: "2026-09-14",
    })).rejects.toMatchObject({ code: "GOOGLE_OPERATIONAL_CALENDAR_DATE_RANGE_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
