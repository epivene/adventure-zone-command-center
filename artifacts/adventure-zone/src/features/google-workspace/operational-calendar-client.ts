import { apiFetch } from "@/lib/auth-token";

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body
      ? String((body as any).error)
      : `API ${response.status}`;
    throw new Error(error);
  }
  return body as T;
}

export type OperationalCalendarConnectionView = {
  id: string;
  email: string;
  role: "operational_calendar";
  operationalCalendarId: string | null;
  status: "connected" | "reauthorization_required" | "disconnected";
  lastErrorCode: string | null;
};

export type OperationalCalendarReview = {
  id: string;
  bookingId: string | null;
  calendarId: string;
  googleEventId: string;
  reason: string;
  proposedChanges: Record<string, unknown>;
  state: "pending" | "accepted" | "rejected";
  createdAt: string;
};

export type OperationalCalendarCandidate = {
  bookingId: string;
  profileId: string | null;
  bookingName: string;
  profileName: string | null;
  city: string;
  region: string;
  startsAt: string | null;
  endsAt: string | null;
  travelLegName: string | null;
};

export type OperationalCalendarStatus = {
  connection: OperationalCalendarConnectionView | null;
  pendingReviewCount: number;
  reviews: OperationalCalendarReview[];
  reviewEvents?: Array<Record<string, unknown>>;
};

export type OperationalCalendarImportRow = {
  googleEventId: string;
  title: string;
  outcome: "matched" | "created" | "review" | "already_linked";
  bookingId: string | null;
  bookingName: string | null;
  reason: string | null;
};

export type OperationalCalendarImportResult = {
  matched: number;
  updated: number;
  created: number;
  review: number;
  rows: number;
  results: OperationalCalendarImportRow[];
};

export async function startOperationalCalendarOAuth() {
  return json<{ authorizationUrl: string }>(await apiFetch("/google-workspace/oauth/start", {
    method: "POST",
    body: JSON.stringify({ connectionRole: "operational_calendar", returnPath: "/settings/google-workspace" }),
  }));
}

export async function disconnectOperationalCalendar() {
  return json<{ ok: true }>(await apiFetch("/google-workspace/disconnect", {
    method: "POST",
    body: JSON.stringify({ connectionRole: "operational_calendar" }),
  }));
}

export async function getOperationalCalendarStatus() {
  return json<OperationalCalendarStatus>(await apiFetch("/google-workspace/operational-calendar"));
}

export async function importOperationalCalendar(input?: { from?: string; to?: string }) {
  return json<OperationalCalendarImportResult>(
    await apiFetch("/google-workspace/operational-calendar/import", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  );
}

export async function decideOperationalCalendarReview(reviewId: string, decision: "accepted" | "rejected") {
  return json<{ ok: true }>(await apiFetch(
    `/google-workspace/operational-calendar/reviews/${encodeURIComponent(reviewId)}/decision`,
    { method: "POST", body: JSON.stringify({ decision }) },
  ));
}

export async function resolveOperationalCalendarReview(
  reviewId: string,
  resolution: "link_existing" | "create_new",
  bookingId?: string,
) {
  return json<{ ok: true; state: "accepted"; bookingId: string; created: boolean }>(await apiFetch(
    `/google-workspace/operational-calendar/reviews/${encodeURIComponent(reviewId)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({
        resolution,
        ...(bookingId ? { bookingId } : {}),
      }),
    },
  ));
}
