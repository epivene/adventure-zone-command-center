import type { GoogleWorkspaceReadClient, GoogleCalendarEvent } from "../google-workspace/google-api-types";
import { classifyCalendarBooking, type CalendarPackageReservation } from "./calendar-booking-classifier";
import { calendarDate, normalizeStoredCalendarWindow, proposedBookingWindow, type DateOnlyWindow } from "./calendar-window";

export type LeadAvailabilityLead = { id: string; reviewVersion: number; state: string; organizationId?: string | null; recipientEmail?: string | null; recipientConfirmed?: boolean; introductionSuitable?: boolean; startDate?: string | null; endDate?: string | null };
export type LeadAvailabilitySnapshot = { rowId: string; expectedVersion: number; organizationId: string; recipientEmail: string; startDate: string; endDate: string; ready: boolean; proposedWindow: DateOnlyWindow; checkedAt: string; checkedBy: string; selectedCalendarIds: string[]; sourceEvents: Array<Record<string, unknown>>; reservations: CalendarPackageReservation[] };
export type LeadAvailabilityPersistence = { loadVerifiedLead(rowId: string): Promise<LeadAvailabilityLead | null>; selectedCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>>; save(snapshot: LeadAvailabilitySnapshot): Promise<{ reviewVersion: number }> };
export class LeadAvailabilityServiceError extends Error { constructor(public readonly code: "ROW_NOT_FOUND" | "VERSION_CONFLICT" | "AVAILABILITY_NOT_READY" | "GOOGLE_REAUTHORIZATION_REQUIRED" | "GOOGLE_CALENDAR_UNAVAILABLE", message: string) { super(message); this.name = "LeadAvailabilityServiceError"; } }

function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function overlaps(left: DateOnlyWindow, right: DateOnlyWindow) { return left.startDate <= right.endDate && right.startDate <= left.endDate; }
function serviceError(error: unknown): never {
 if (error instanceof LeadAvailabilityServiceError) throw error;
 const code = (error as { code?: string }).code || (error instanceof Error ? error.message : "");
 if (code === "ROW_NOT_FOUND" || code === "VERSION_CONFLICT" || code === "AVAILABILITY_NOT_READY") throw new LeadAvailabilityServiceError(code, error instanceof Error ? error.message : code);
 if (code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" || code === "GOOGLE_REAUTHORIZATION_REQUIRED" || code === "GOOGLE_WORKSPACE_NOT_AUTHENTICATED") throw new LeadAvailabilityServiceError("GOOGLE_REAUTHORIZATION_REQUIRED", "Google Calendar authorization must be renewed before checking availability.");
 throw new LeadAvailabilityServiceError("GOOGLE_CALENDAR_UNAVAILABLE", "Google Calendar could not be checked. Reauthorize or retry before proceeding.");
}
function canonicalIdentity(event: GoogleCalendarEvent) {
 if (!event.iCalUid) return `${event.calendarId}|${event.id}`;
 const original = event.originalStartTime || event.start;
 const value = original.date || (original.dateTime ? new Date(original.dateTime).toISOString() : calendarDate(original, event.calendarTimeZone));
 return `${event.iCalUid}|${value}`;
}
function sourceEvidence(event: GoogleCalendarEvent, reservation: CalendarPackageReservation | null): Record<string, unknown> {
 return { calendarId: event.calendarId, eventId: event.id, iCalUid: event.iCalUid, updated: event.updated, recurringEventId: event.recurringEventId,
  calendarTimeZone: event.calendarTimeZone, start: event.start, end: event.end, originalStartTime: event.originalStartTime,
  summary: event.summary, description: event.description, classification: reservation ? { confidence: reservation.confidence, packages: reservation.packages, evidence: reservation.evidence, occupiedWindow: reservation.occupiedWindow } : null };
}

export class LeadAvailabilityService {
 constructor(private readonly options: { persistence: LeadAvailabilityPersistence; google: Required<Pick<GoogleWorkspaceReadClient, "listCalendarEvents">>; now?: () => Date }) {}
 async check(input: { rowId: string; expectedVersion: number; checkedBy: string }) {
  let lead: LeadAvailabilityLead | null; try { lead = await this.options.persistence.loadVerifiedLead(input.rowId); } catch (error) { serviceError(error); }
  if (!lead) throw new LeadAvailabilityServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
  if (lead.reviewVersion !== input.expectedVersion) throw new LeadAvailabilityServiceError("VERSION_CONFLICT", "This lead was changed in another review. Reload it before checking availability.");
  if (lead.state !== "verified" || !lead.organizationId || !lead.recipientEmail?.trim() || !lead.recipientConfirmed || !lead.introductionSuitable || !lead.startDate || !lead.endDate) throw new LeadAvailabilityServiceError("AVAILABILITY_NOT_READY", "Verify the profile, recipient, and dates before checking availability.");
  const proposedWindow = proposedBookingWindow({ startDate: lead.startDate, endDate: lead.endDate });
  let calendars; try { calendars = await this.options.persistence.selectedCalendars(); } catch (error) { serviceError(error); }
  if (!calendars.length) throw new LeadAvailabilityServiceError("AVAILABILITY_NOT_READY", "Select at least one Google Calendar before checking availability.");
  let events: GoogleCalendarEvent[]; try { events = await this.options.google.listCalendarEvents({ calendarIds: calendars.map((item) => item.id), timeMin: `${addDays(proposedWindow.startDate, -1)}T00:00:00.000Z`, timeMax: `${addDays(proposedWindow.endDate, 2)}T00:00:00.000Z` }); } catch (error) { serviceError(error); }
  const groups = new Map<string, GoogleCalendarEvent[]>(); for (const event of events) { const key = canonicalIdentity(event); groups.set(key, [...(groups.get(key) || []), event]); }
  const reservations: CalendarPackageReservation[] = []; const evidenceByEvent = new Map<string, CalendarPackageReservation | null>();
  for (const group of groups.values()) {
   const event = group[0]!; const occupiedWindow = normalizeStoredCalendarWindow({ start: event.start, end: event.end, calendarTimeZone: event.calendarTimeZone });
   if (!overlaps(proposedWindow, occupiedWindow)) { for (const copy of group) evidenceByEvent.set(`${copy.calendarId}|${copy.id}`, null); continue; }
   const classified = classifyCalendarBooking({ summary: event.summary, description: event.description });
   const reservation: CalendarPackageReservation = { calendarEventId: event.id, iCalUid: event.iCalUid, occupiedWindow, packages: classified.packages, confidence: classified.confidence, evidence: [...classified.evidence, ...group.map((copy) => `google-event:${copy.calendarId}/${copy.id}`)] };
   reservations.push(reservation); for (const copy of group) evidenceByEvent.set(`${copy.calendarId}|${copy.id}`, reservation);
  }
  const checkedAt = (this.options.now?.() ?? new Date()).toISOString(); const ready = reservations.every((item) => item.confidence === "explicit");
  let saved; try { saved = await this.options.persistence.save({ rowId: lead.id, expectedVersion: lead.reviewVersion, organizationId: lead.organizationId, recipientEmail: lead.recipientEmail, startDate: lead.startDate, endDate: lead.endDate, ready, proposedWindow, checkedAt, checkedBy: input.checkedBy, selectedCalendarIds: calendars.map((item) => item.id), sourceEvents: events.map((event) => sourceEvidence(event, evidenceByEvent.get(`${event.calendarId}|${event.id}`) || null)), reservations }); } catch (error) { serviceError(error); }
  return { rowId: lead.id, reviewVersion: saved.reviewVersion, ready, proposedWindow, checkedAt, reservations };
 }
}