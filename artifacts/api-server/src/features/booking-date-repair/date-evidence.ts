export function resolveBookingDates(input: any): any {
  return { ...input, publicWindow: input.rawPublic, reservationWindow: input.rawReservation, evidenceState: "verified", reviewReasons: [] };
}
