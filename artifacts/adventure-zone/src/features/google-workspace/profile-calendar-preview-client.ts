import { apiFetch } from "@/lib/auth-token";
export type CalendarProposal = { profileId: string; bookingId: string; setupOn?: string; teardownOn?: string };
export type CalendarPreview = {
  id: string; fingerprint: string; expiresAt: string; calendarId: string | null;
  facts: { name: string; venue: string; startsOn: string | null; endsOn: string | null;
    setupOn: string | null; teardownOn: string | null; packages: Array<{ key: string; name: string }>;
    sources: Array<{ type: string; id: string; revision: string; label: string; href: string }> };
  setupOn: string | null; teardownOn: string | null; problems: string[];
  events: Array<{ eventId: string; packageKey: string; mode: string; existing?: { summary: string; description: string; startDate: string; endDateExclusive: string } | null; input: {
    summary: string; description: string; startDate: string; endDateExclusive: string } }>;
};
export type CalendarReceipt = { state: "saved"; previewId: string; savedAt: string;
  events: Array<{ id: string; packageKey: string; href: string }> };
export class CalendarPreviewError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
async function post<T>(action: string, input: unknown): Promise<T> {
  const response = await apiFetch("/google-workspace/operational-calendar/profile/" + action,
    { method: "POST", body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw new CalendarPreviewError(result.error ?? "Calendar review is unavailable.", response.status);
  return result as T;
}
export const profileCalendarClient = {
  preview: (input: CalendarProposal) => post<CalendarPreview>("preview", input),
  apply: (input: { previewId: string; fingerprint: string }) => post<CalendarReceipt>("apply", input),
};
