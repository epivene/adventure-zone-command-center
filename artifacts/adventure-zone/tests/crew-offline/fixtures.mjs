export const leg = { id: "offline-test-leg", name: "Offline test leg", color: null };
export const manager = { legId: leg.id, legName: leg.name, managerName: "Test manager" };
export const event = {
  bookingId: "offline-test-booking", bookingName: "Offline regression festival",
  city: "Test city", region: "TX", latitude: 30.125, longitude: -97.25,
  startsAt: "2026-10-10T12:00:00.000Z", endsAt: "2026-10-11T12:00:00.000Z",
  status: "booked", probability: null, scheduleState: "booked",
};
export const map = { leg, trips: [], route: null, events: [event], meetups: [] };
export const crew = {
  bookingId: event.bookingId, year: 2026,
  crewLocation: {
    venue: "Test fairgrounds, 12 Festival Road",
    editionUpdatedAt: "2026-10-09T12:00:00.000Z",
    location: { latitude: 30.125, longitude: -97.25, displayName: "Crew gate, 12 Festival Road" },
    stops: [{
      id: "offline-test-stop", updatedAt: "2026-10-09T12:00:00.000Z",
      expectedUpdatedAt: null, name: "Test RV supply stop", category: "walmart",
      address: "34 Supply Road, Test city, TX", latitude: 30.25, longitude: -97.5,
      notes: "Use the east entrance.\nCall the property before parking overnight.",
      rigFit: "unknown", hookups: "unknown", overnight: "unknown",
      rigFitConfirmedOn: null, hookupsConfirmedOn: null, overnightConfirmedOn: null,
      maxRigLengthFeet: null, phone: null, website: null, sourceKey: null, sourceUrl: null,
    }],
  },
};
