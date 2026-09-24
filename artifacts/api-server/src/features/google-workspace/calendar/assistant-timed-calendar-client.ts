import type { GoogleWorkspaceEnvironment } from "../google-workspace-env";
import {
  timedCalendarBody,
  type TimedEvent,
  calendarEventId,
} from "../../assistant-workspace/calendar-tools";
export type AssistantCalendarEvent = {
  id: string;
  etag: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties?: { private?: Record<string, string> };
};
export function createAssistantTimedCalendarClient(input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;
  async function request(
    calendarId: string,
    eventId: string | null,
    method = "GET",
    body?: unknown,
    etag?: string,
  ) {
    const signal = AbortSignal.timeout(15000);
    if (!token || token.expiresAt < Date.now()) {
      const response = await fetcher("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: input.environment.clientId,
          client_secret: input.environment.clientSecret,
          refresh_token: input.refreshToken,
          grant_type: "refresh_token",
        }),
        signal,
      });
      const auth = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!response.ok || !auth.access_token)
        throw new Error("CALENDAR_REAUTHORIZATION_REQUIRED");
      token = {
        value: auth.access_token,
        expiresAt:
          Date.now() + Math.max(0, (auth.expires_in ?? 3600) - 60) * 1000,
      };
    }
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}?sendUpdates=none`;
    const response = await fetcher(url, {
      method,
      headers: {
        authorization: `Bearer ${token.value}`,
        "content-type": "application/json",
        ...(etag ? { "If-Match": etag } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    if (response.status === 412) throw new Error("CALENDAR_ETAG_CONFLICT");
    if (response.status === 409) throw new Error("CALENDAR_ALREADY_EXISTS");
    if (!response.ok) throw new Error("CALENDAR_REQUEST_FAILED");
    return (await response.json()) as AssistantCalendarEvent;
  }
  const get = (calendarId: string, eventId: string) =>
    request(calendarId, eventId);
  function matches(actual: AssistantCalendarEvent, event: TimedEvent) {
    return (
      actual.summary === event.summary &&
      Date.parse(actual.start?.dateTime) === Date.parse(event.startsAt) &&
      Date.parse(actual.end?.dateTime) === Date.parse(event.endsAt) &&
      actual.start?.timeZone === event.timeZone &&
      actual.end?.timeZone === event.timeZone
    );
  }
  return {
    get,
    async create(event: TimedEvent, actionId: string) {
      try {
        await request(
          event.calendarId,
          null,
          "POST",
          timedCalendarBody(event, actionId),
        );
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            error.message === "CALENDAR_ALREADY_EXISTS"
          )
        )
          throw error;
      }
      const saved = await get(event.calendarId, calendarEventId(actionId));
      if (
        !matches(saved, event) ||
        saved.extendedProperties?.private?.assistantActionId !== actionId
      )
        throw new Error("CALENDAR_READBACK_MISMATCH");
      return saved;
    },
    async update(
      event: TimedEvent,
      eventId: string,
      etag: string,
      actionId: string,
    ) {
      if (!etag) throw new Error("CALENDAR_ETAG_REQUIRED");
      const { id: _, ...body } = timedCalendarBody(event, actionId);
      await request(event.calendarId, eventId, "PATCH", body, etag);
      const saved = await get(event.calendarId, eventId);
      if (!matches(saved, event)) throw new Error("CALENDAR_READBACK_MISMATCH");
      return saved;
    },
  };
}
