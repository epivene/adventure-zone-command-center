import type { OperationsViewer } from "@workspace/api-zod";
import type { BookingLegOperationsRepository } from "@/features/bookings/booking-leg-operations-repository";
import { OperationsAccessError } from "@/features/bookings/booking-leg-operations-repository";
import { getCrewLocation } from "./crew-service";

/** Resolve the annual edition from the booking, never a caller-supplied profile/year. */
export class AssignedCrewService {
  constructor(
    private readonly bookings: Pick<BookingLegOperationsRepository, "loadBase">,
    private readonly loadCrew: typeof getCrewLocation = getCrewLocation,
  ) {}

  async get(bookingId: string, viewer: Exclude<OperationsViewer, { kind: "owner" }>) {
    const base = await this.bookings.loadBase(bookingId, viewer);
    if (!base) throw new OperationsAccessError(404, "Booking not found.");
    // Apply assignment checks before reading any linked profile information.
    if (!base.booking.travelLegId ||
      (viewer.kind === "manager" && base.booking.travelLegId !== viewer.legId)) {
      throw new OperationsAccessError(403, "This event is outside your assigned travel access.");
    }
    const { profileId, seasonYear } = base.booking;
    const year = seasonYear && seasonYear >= 1900 && seasonYear <= 2200 ? seasonYear : null;
    return {
      bookingId,
      year,
      crewLocation: profileId && year ? await this.loadCrew(profileId, year) : null,
    };
  }
}
