import type { GoogleWorkspaceEnvironment } from "@/features/google-workspace/google-workspace-env";

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const calendarBaseEndpoint = "https://www.googleapis.com/calendar/v3/calendars";

export type OperationalCalendarEventInput = {
  /** Optional stable Google event identity for retry-safe creation. */
  id?: string;
  summary: string;
  description: string;
  startDate: string;
  endDateExclusive: string;
};

export type OperationalCalendarEvent = OperationalCalendarEventInput & {
  id: string;
  etag: string | null;
  updated: string | null;
  status: string | null;
  /** Missing on historical snapshots; never sufficient to verify an all-day save. */
  eventKind?: "all_day" | "timed";
  rawStart?: Record<string, unknown>;
  rawEnd?: Record<string, unknown>;
};

export interface OperationalCalendarClient {
  getEvent(calendarId: string, eventId: string): Promise<OperationalCalendarEvent | null>;
  listEvents(input: {
    calendarId: string;
    timeMin: string;
    timeMax: string;
    pageToken?: string | null;
  }): Promise<{ events: OperationalCalendarEvent[]; nextPageToken: string | null }>;
  createEvent(calendarId: string, event: OperationalCalendarEventInput): Promise<OperationalCalendarEvent>;
  updateEvent(input: {
    calendarId: string;
    eventId: string;
    event: OperationalCalendarEventInput;
    etag?: string | null;
  }): Promise<OperationalCalendarEvent>;
}

export type OperationalCalendarFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type TokenPayload = {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
};

function clientError(code: string, status?: number) {
  return Object.assign(new Error(code), { code, status });
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timedEventDateRange(startDateTime: string, endDateTime: string) {
  const startDate = startDateTime.slice(0, 10);
  const endDate = endDateTime.slice(0, 10);
  if (!validDate(startDate) || !validDate(endDate)) return null;

  const endLocalTime = endDateTime.slice(11, 19);
  const endsExactlyAtMidnight = endLocalTime === "00:00:00";
  const endDateExclusive = endsExactlyAtMidnight && endDate > startDate
    ? endDate
    : addUtcDays(endDate, 1);

  return endDateExclusive > startDate ? { startDate, endDateExclusive } : null;
}

function validateEventInput(input: OperationalCalendarEventInput) {
  if (!input.summary.trim()) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_SUMMARY_REQUIRED");
  if (!validDate(input.startDate) || !validDate(input.endDateExclusive)) {
    throw clientError("GOOGLE_OPERATIONAL_CALENDAR_DATE_INVALID");
  }
  if (input.endDateExclusive <= input.startDate) {
    throw clientError("GOOGLE_OPERATIONAL_CALENDAR_DATE_RANGE_INVALID");
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseEvent(value: Record<string, unknown>): OperationalCalendarEvent {
  const start = value.start && typeof value.start === "object" ? value.start as Record<string, unknown> : {};
  const end = value.end && typeof value.end === "object" ? value.end as Record<string, unknown> : {};
  const allDayRange = typeof start.date === "string" && typeof end.date === "string"
    ? { startDate: start.date, endDateExclusive: end.date }
    : null;
  const timedRange = typeof start.dateTime === "string" && typeof end.dateTime === "string"
    ? timedEventDateRange(start.dateTime, end.dateTime)
    : null;
  const dateRange = allDayRange ?? timedRange;

  if (
    typeof value.id !== "string" || !value.id.trim() ||
    typeof value.summary !== "string" ||
    !dateRange ||
    !validDate(dateRange.startDate) ||
    !validDate(dateRange.endDateExclusive) ||
    dateRange.endDateExclusive <= dateRange.startDate
  ) {
    throw clientError("GOOGLE_OPERATIONAL_CALENDAR_EVENT_RESPONSE_INVALID");
  }
  return {
    id: value.id,
    eventKind: allDayRange && !timedRange ? "all_day" : "timed",
    rawStart: { ...start },
    rawEnd: { ...end },
    etag: typeof value.etag === "string" ? value.etag : null,
    summary: value.summary,
    description: typeof value.description === "string" ? value.description : "",
    startDate: dateRange.startDate,
    endDateExclusive: dateRange.endDateExclusive,
    updated: typeof value.updated === "string" ? value.updated : null,
    status: typeof value.status === "string" ? value.status : null,
  };
}

export function createOperationalCalendarClient(input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken: string;
  fetcher?: OperationalCalendarFetch;
}): OperationalCalendarClient {
  const fetcher = input.fetcher ?? fetch;
  const refreshToken = input.refreshToken.trim();
  if (!refreshToken) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_REFRESH_TOKEN_MISSING");
  let accessToken: { value: string; expiresAt: number } | null = null;

  async function token(force = false): Promise<string> {
    if (!force && accessToken && Date.now() < accessToken.expiresAt) return accessToken.value;
    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.environment.clientId,
        client_secret: input.environment.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = await json(response) as TokenPayload;
    if (!response.ok) {
      if (body.error === "invalid_grant") {
        throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED", response.status);
      }
      throw clientError("GOOGLE_OPERATIONAL_CALENDAR_TOKEN_REQUEST_FAILED", response.status);
    }
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw clientError("GOOGLE_OPERATIONAL_CALENDAR_TOKEN_RESPONSE_INVALID");
    }
    const expires = typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : 3600;
    accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(0, expires - 60) * 1000,
    };
    return accessToken.value;
  }

  async function request(
    url: string,
    init: RequestInit = {},
    retryUnauthorized = true,
  ): Promise<Response> {
    const bearer = await token(!retryUnauthorized);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${bearer}`);
    const response = await fetcher(url, { ...init, headers });
    if (response.status === 401 && retryUnauthorized) {
      accessToken = null;
      return request(url, init, false);
    }
    return response;
  }

  function endpoint(calendarId: string, eventId?: string) {
    if (!calendarId.trim()) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_ID_REQUIRED");
    const base = `${calendarBaseEndpoint}/${encodeURIComponent(calendarId.trim())}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  }

  function eventBody(event: OperationalCalendarEventInput, patch = false) {
    validateEventInput(event);
    return JSON.stringify({
      ...(!patch && event.id ? { id: event.id } : {}),
      summary: event.summary.trim(),
      description: event.description,
      start: { date: event.startDate, ...(patch ? { dateTime: null, timeZone: null } : {}) },
      end: { date: event.endDateExclusive, ...(patch ? { dateTime: null, timeZone: null } : {}) },
      ...(!patch ? { transparency: "opaque" } : {}),
    });
  }

  return {
    async getEvent(calendarId, eventId) {
      const response = await request(endpoint(calendarId, eventId));
      if (response.status === 404) return null;
      if (!response.ok) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_GET_FAILED", response.status);
      return parseEvent(await json(response));
    },

    async listEvents({ calendarId, timeMin, timeMax, pageToken }) {
      const url = new URL(endpoint(calendarId));
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("orderBy", "startTime");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await request(url.toString());
      if (!response.ok) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_LIST_FAILED", response.status);
      const body = await json(response);
      const items = Array.isArray(body.items) ? body.items : [];
      return {
        events: items
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map(parseEvent),
        nextPageToken: typeof body.nextPageToken === "string" ? body.nextPageToken : null,
      };
    },

    async createEvent(calendarId, event) {
      const response = await request(endpoint(calendarId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: eventBody(event),
      });
      if (!response.ok) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_CREATE_FAILED", response.status);
      return parseEvent(await json(response));
    },

    async updateEvent({ calendarId, eventId, event, etag }) {
      const headers = new Headers({ "content-type": "application/json" });
      if (etag) headers.set("if-match", etag);
      const response = await request(endpoint(calendarId, eventId), {
        method: "PATCH",
        headers,
        // Patch only reviewed fields; preserve reminders, attendees, location and other provider settings.
        body: eventBody(event, true),
      });
      if (response.status === 412) {
        throw clientError("GOOGLE_OPERATIONAL_CALENDAR_CONFLICT", 412);
      }
      if (response.status === 404) {
        throw clientError("GOOGLE_OPERATIONAL_CALENDAR_EVENT_MISSING", 404);
      }
      if (!response.ok) throw clientError("GOOGLE_OPERATIONAL_CALENDAR_UPDATE_FAILED", response.status);
      return parseEvent(await json(response));
    },
  };
}