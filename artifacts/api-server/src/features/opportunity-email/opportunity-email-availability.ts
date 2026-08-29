import type { GoogleCalendarEvent, GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import { classifyCalendarBooking, type CalendarPackageReservation } from "@/features/lead-intake/calendar-booking-classifier";
import { normalizeStoredCalendarWindow, proposedBookingWindow } from "@/features/lead-intake/calendar-window";
import {
  calculatePackageAvailability,
  type PackageAvailabilityTemplate,
} from "@/features/lead-intake/package-availability";

type OpportunityContext = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: string;
  emailAutomationProtected: boolean;
  territoryExceptionApproved: boolean;
};

type BookingWindow = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

type SelectedCalendar = {
  id: string;
  summary: string;
  primary: boolean;
};

type CalendarReadClient = Pick<GoogleWorkspaceReadClient, "listCalendarEvents">;

type Dependencies = {
  bookings: { get(id: string): Promise<BookingWindow | null> };
  calendars: { selected(): Promise<SelectedCalendar[]> };
  packages: { active(): Promise<PackageAvailabilityTemplate[]> };
  google: { readClient(): Promise<CalendarReadClient | null> };
};

type AvailabilityResult = {
  calendarEvidence: unknown[];
  packageAvailability: ReturnType<typeof calculatePackageAvailability> | null;
};

function dateOnly(value: Date): string | null {
  return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function overlaps(
  left: { startDate: string; endDate: string },
  right: { startDate: string; endDate: string },
): boolean {
  return left.startDate <= right.endDate && right.startDate <= left.endDate;
}

function reservation(event: GoogleCalendarEvent): CalendarPackageReservation {
  const occupiedWindow = normalizeStoredCalendarWindow({
    start: event.start,
    end: event.end,
    calendarTimeZone: event.calendarTimeZone,
  });
  const classified = classifyCalendarBooking({
    summary: event.summary,
    description: event.description,
  });
  return {
    calendarEventId: event.id,
    iCalUid: event.iCalUid,
    occupiedWindow,
    packages: classified.packages,
    confidence: classified.confidence,
    evidence: [...classified.evidence, `google-event:${event.calendarId}/${event.id}`],
  };
}

export class OpportunityEmailAvailability {
  constructor(private readonly deps: Dependencies) {}

  async resolve(opportunity: OpportunityContext): Promise<AvailabilityResult> {
    if (!opportunity.bookingId) return this.missing();
    const booking = await this.deps.bookings.get(opportunity.bookingId);
    if (!booking?.startsAt || !booking.endsAt) return this.missing();
    const startDate = dateOnly(booking.startsAt);
    const endDate = dateOnly(booking.endsAt);
    if (!startDate || !endDate || endDate < startDate) return this.missing();

    const [calendars, packages, google] = await Promise.all([
      this.deps.calendars.selected(),
      this.deps.packages.active(),
      this.deps.google.readClient(),
    ]);
    if (!calendars.length || !packages.length || !google?.listCalendarEvents) {
      return this.missing();
    }

    const proposedWindow = proposedBookingWindow({ startDate, endDate });
    let events: GoogleCalendarEvent[];
    try {
      events = await google.listCalendarEvents({
        calendarIds: calendars.map(({ id }) => id),
        timeMin: `${addDays(proposedWindow.startDate, -1)}T00:00:00.000Z`,
        timeMax: `${addDays(proposedWindow.endDate, 2)}T00:00:00.000Z`,
      });
    } catch {
      return this.missing();
    }

    const relevant = events
      .map((event) => ({ event, reservation: reservation(event) }))
      .filter(({ reservation }) => overlaps(proposedWindow, reservation.occupiedWindow));
    const reservations = relevant.map(({ reservation }) => reservation);
    const packageAvailability = calculatePackageAvailability({
      packages,
      reservations,
    });
    const calendarEvidence = relevant.map(({ event, reservation }) => ({
      calendarId: event.calendarId,
      eventId: event.id,
      iCalUid: event.iCalUid,
      updated: event.updated,
      summary: event.summary,
      start: event.start,
      end: event.end,
      occupiedWindow: reservation.occupiedWindow,
      confidence: reservation.confidence,
      packages: reservation.packages,
      evidence: reservation.evidence,
    }));

    return { calendarEvidence, packageAvailability };
  }

  private missing(): AvailabilityResult {
    return { calendarEvidence: [], packageAvailability: null };
  }
}
