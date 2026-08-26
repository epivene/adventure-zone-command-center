import type { GoogleWorkspaceReadClient, GoogleCalendarEvent } from "../google-workspace/google-api-types";
import { classifyCalendarBooking, type CalendarPackageReservation } from "./calendar-booking-classifier";
import { calendarDate, normalizeStoredCalendarWindow, proposedBookingWindow, type DateOnlyWindow } from "./calendar-window";
import { calculatePackageAvailability, type PackageAvailabilityResult, type PackageAvailabilityTemplate } from "./package-availability";

export type LeadAvailabilityLead = { id: string; reviewVersion: number; state: string; organizationId?: string | null; recipientEmail?: string | null; recipientConfirmed?: boolean; introductionSuitable?: boolean; startDate?: string | null; endDate?: string | null };
export type LeadAvailabilitySnapshot = { rowId: string; expectedVersion: number; organizationId: string; recipientEmail: string; startDate: string; endDate: string; ready: boolean; proposedWindow: DateOnlyWindow; checkedAt: string; checkedBy: string; selectedCalendarIds: string[]; sourceEvents: Array<Record<string, unknown>>; reservations: CalendarPackageReservation[]; packageAvailability: PackageAvailabilityResult };
export type LeadAvailabilityPersistence = { loadVerifiedLead(rowId: string): Promise<LeadAvailabilityLead | null>; selectedCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>>; packageAvailabilityTemplates?(): Promise<PackageAvailabilityTemplate[]>; save(snapshot: LeadAvailabilitySnapshot): Promise<{ reviewVersion: number }> };
export class LeadAvailabilityServiceError extends Error { constructor(public readonly code: "ROW_NOT_FOUND" | "VERSION_CONFLICT" | "AVAILABILITY_NOT_READY" | "GOOGLE_REAUTHORIZATION_REQUIRED" | "GOOGLE_CALENDAR_UNAVAILABLE" | "AVAILABILITY_PERSISTENCE_FAILED", message: string) { super(message); this.name = "LeadAvailabilityServiceError"; } }

function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function overlaps(left: DateOnlyWindow, right: DateOnlyWindow) { return left.startDate <= right.endDate && right.startDate <= left.endDate; }
function serviceError(error: unknown, source: "google" | "persistence"): never {
 if (error instanceof LeadAvailabilityServiceError) throw error;
 const code = (error as { code?: string }).code || (error instanceof Error ? error.message : "");
 if (code === "ROW_NOT_FOUND" || code === "VERSION_CONFLICT" || code === "AVAILABILITY_NOT_READY") throw new LeadAvailabilityServiceError(code, error instanceof Error ? error.message : code);
 if (code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" || code === "GOOGLE_REAUTHORIZATION_REQUIRED" || code === "GOOGLE_WORKSPACE_NOT_AUTHENTICATED") throw new LeadAvailabilityServiceError("GOOGLE_REAUTHORIZATION_REQUIRED", "Google Calendar authorization must be renewed before checking availability.");
 if (source === "google") throw new LeadAvailabilityServiceError("GOOGLE_CALENDAR_UNAVAILABLE", "Google Calendar could not be checked. Reauthorize or retry before proceeding.");
 throw new LeadAvailabilityServiceError("AVAILABILITY_PERSISTENCE_FAILED", "Lead availability could not be recorded. Retry after the service is restored.");
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
  let lead: LeadAvailabilityLead | null; try { lead = await this.options.persistence.loadVerifiedLead(input.rowId); } catch (error) { serviceError(error, "persistence"); }
  if (!lead) throw new LeadAvailabilityServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
  if (lead.reviewVersion !== input.expectedVersion) throw new LeadAvailabilityServiceError("VERSION_CONFLICT", "This lead was changed in another review. Reload it before checking availability.");
  if (lead.state !== "verified" || !lead.organizationId || !lead.recipientEmail?.trim() || !lead.recipientConfirmed || !lead.introductionSuitable || !lead.startDate || !lead.endDate) throw new LeadAvailabilityServiceError("AVAILABILITY_NOT_READY", "Verify the profile, recipient, and dates before checking availability.");
  const proposedWindow = proposedBookingWindow({ startDate: lead.startDate, endDate: lead.endDate });
  let calendars; try { calendars = await this.options.persistence.selectedCalendars(); } catch (error) { serviceError(error, "persistence"); }
  if (!calendars.length) throw new LeadAvailabilityServiceError("AVAILABILITY_NOT_READY", "Select at least one Google Calendar before checking availability.");
  let inventory: PackageAvailabilityTemplate[] = []; try { inventory = await this.options.persistence.packageAvailabilityTemplates?.() ?? []; } catch (error) { serviceError(error, "persistence"); }
  let events: GoogleCalendarEvent[]; try { events = await this.options.google.listCalendarEvents({ calendarIds: calendars.map((item) => item.id), timeMin: `${addDays(proposedWindow.startDate, -1)}T00:00:00.000Z`, timeMax: `${addDays(proposedWindow.endDate, 2)}T00:00:00.000Z` }); } catch (error) { serviceError(error, "google"); }
  const groups = new Map<string, GoogleCalendarEvent[]>(); for (const event of events) { const key = canonicalIdentity(event); groups.set(key, [...(groups.get(key) || []), event]); }
  const reservations: CalendarPackageReservation[] = []; const evidenceByEvent = new Map<string, CalendarPackageReservation | null>();
  for (const group of groups.values()) {
   const assessed = group.map((event) => {
    const occupiedWindow = normalizeStoredCalendarWindow({ start: event.start, end: event.end, calendarTimeZone: event.calendarTimeZone });
    const classified = classifyCalendarBooking({ summary: event.summary, description: event.description });
    const individual: CalendarPackageReservation = { calendarEventId: event.id, iCalUid: event.iCalUid, occupiedWindow, packages: classified.packages, confidence: classified.confidence, evidence: [...classified.evidence, `google-event:${event.calendarId}/${event.id}`] };
    evidenceByEvent.set(`${event.calendarId}|${event.id}`, individual);
    return { event, occupiedWindow, classified, individual };
   });
   if (!assessed.some((item) => overlaps(proposedWindow, item.occupiedWindow))) continue;
   const first = assessed[0]!;
   const fingerprint = (item: typeof first) => JSON.stringify({ window: item.occupiedWindow, confidence: item.classified.confidence, packages: [...item.classified.packages].sort((a, b) => a.packageKey.localeCompare(b.packageKey)), evidence: [...item.classified.evidence].sort(), updated: item.event.updated || null });
   const agreeing = assessed.every((item) => item.classified.confidence === "explicit" && fingerprint(item) === fingerprint(first));
   const occupiedWindow = agreeing ? first.occupiedWindow : {
    startDate: assessed.map((item) => item.occupiedWindow.startDate).sort()[0]!,
    endDate: assessed.map((item) => item.occupiedWindow.endDate).sort().at(-1)!,
   };
   const reservation: CalendarPackageReservation = assessed.length === 1 ? first.individual : agreeing
    ? { ...first.individual, evidence: [...first.individual.evidence.filter((item) => !item.startsWith("google-event:")), ...assessed.map((item) => `google-event:${item.event.calendarId}/${item.event.id}`)] }
    : { calendarEventId: first.event.id, iCalUid: first.event.iCalUid, occupiedWindow, packages: [], confidence: "ambiguous", evidence: ["conflicting same-instance Calendar evidence", ...assessed.flatMap((item) => [`google-event:${item.event.calendarId}/${item.event.id}`, `window:${item.occupiedWindow.startDate}/${item.occupiedWindow.endDate}`, `updated:${item.event.updated || "missing"}`, ...item.classified.evidence])] };
   reservations.push(reservation);
  }
  const packageAvailability = calculatePackageAvailability({ packages: inventory, reservations });
  const checkedAt = (this.options.now?.() ?? new Date()).toISOString(); const ready = reservations.every((item) => item.confidence === "explicit") && packageAvailability.status === "resolved";
  let saved; try { saved = await this.options.persistence.save({ rowId: lead.id, expectedVersion: lead.reviewVersion, organizationId: lead.organizationId, recipientEmail: lead.recipientEmail, startDate: lead.startDate, endDate: lead.endDate, ready, proposedWindow, checkedAt, checkedBy: input.checkedBy, selectedCalendarIds: calendars.map((item) => item.id), sourceEvents: events.map((event) => sourceEvidence(event, evidenceByEvent.get(`${event.calendarId}|${event.id}`) || null)), reservations, packageAvailability }); } catch (error) { serviceError(error, "persistence"); }
  return { rowId: lead.id, reviewVersion: saved.reviewVersion, ready, proposedWindow, checkedAt, reservations, packageAvailability };
 }
}
