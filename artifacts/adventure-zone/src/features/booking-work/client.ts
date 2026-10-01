import { apiFetch } from "@/lib/auth-token";
export const statuses = [
  "queued",
  "researching",
  "draft_ready",
  "waiting_desiree",
  "waiting_customer",
  "blocked",
  "completed",
  "cancelled",
] as const;
export const queues = [
  "new_leads",
  "replies",
  "followups",
  "paperwork",
  "routes",
] as const;
export type Actor = {
  kind: "owner" | "connection";
  id: string;
  label?: string;
};
export type WorkActivity = {
  id: string;
  profileId: string;
  eventYear: number;
  bookingId: string | null;
  title: string;
  queue: (typeof queues)[number];
  status: (typeof statuses)[number];
  nextAction: string;
  assignedTo: Actor | null;
  dueAt: string | null;
  progress: { completed: number; total: number; summary: string } | null;
  links: Array<{
    kind: "email" | "draft" | "document" | "followup";
    label: string;
    url?: string;
    recordId?: string;
  }>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type WorkPage = { items: WorkActivity[]; nextCursor: string | null };
export const labels: Record<string, string> = {
  queued: "Queued",
  researching: "Researching",
  draft_ready: "Draft ready",
  waiting_desiree: "Waiting on Desiree",
  waiting_customer: "Waiting on customer",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
  new_leads: "New leads & outreach",
  replies: "Replies & active bookings",
  followups: "Follow-ups & returning events",
  paperwork: "Booking paperwork",
  routes: "Legs, routes & capacity",
};
export class WorkRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public current?: WorkActivity,
  ) {
    super(message);
  }
}
export async function workRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await apiFetch("/booking-work" + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const d = await r.json();
  if (!r.ok)
    throw new WorkRequestError(
      d.error ?? "Could not load booking work.",
      r.status,
      d.current,
    );
  return d;
}
export function reviewLink(
  l: WorkActivity["links"][number],
  profileId: string,
) {
  if (l.kind === "email") {
    try {
      const u = new URL(l.url ?? "");
      return u.protocol === "https:" ? u.href : null;
    } catch {
      return null;
    }
  }
  if (!l.recordId || !/^[-a-zA-Z0-9]+$/.test(l.recordId)) return null;
  if (l.kind === "draft")
    return `/settings/chatgpt-connection?draft=${encodeURIComponent(l.recordId)}`;
  return `/profiles/${encodeURIComponent(profileId)}?workReview=${l.kind}&recordId=${encodeURIComponent(l.recordId)}#work-record-review`;
}
export const ownerLabel = (a: Actor | null, actors: Actor[]) =>
  !a
    ? "Unassigned"
    : (actors.find((x) => x.id === a.id && x.kind === a.kind)?.label ??
      (a.kind === "owner" ? "Desiree / owner" : "Com connection"));
