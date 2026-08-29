import { describe,expect,it } from "vitest";
import { loadLegManagerDashboard,type LegManagerDashboardDependencies,type LegManagerDashboardRepository } from "./leg-manager-dashboard";
const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002";
class Repo implements LegManagerDashboardRepository{async listTrips(o:{travelLegId:string}){return [{id:"ta",travelLegId:A,name:"A Trip",startDate:new Date("2026-08-15"),endDate:new Date("2026-08-20"),startLabel:"A",endLabel:"B"},{id:"tb",travelLegId:B,name:"B Trip",startDate:new Date("2026-08-15"),endDate:new Date("2026-08-20"),startLabel:"X",endLabel:"Y"}].filter(t=>t.travelLegId===o.travelLegId)}async listStops(id:string){return id==="ta"?[{id:"sa",tripId:"ta",bookingId:"ba",sortOrder:1,bookingName:"A Event",city:"A City",region:"ND",latitude:null,longitude:null,startsAt:new Date("2026-08-16"),endsAt:new Date("2026-08-16"),status:"confirmed"}]:[{id:"sb",tripId:"tb",bookingId:"bb",sortOrder:1,bookingName:"B Event",city:"B City",region:"ND",latitude:null,longitude:null,startsAt:new Date("2026-08-16"),endsAt:new Date("2026-08-16"),status:"confirmed"}]}async listSegments(){return []}}
describe("manager dashboard leg scope",()=>{it("returns only the authenticated leg existing trips/bookings",async()=>{const d=await loadLegManagerDashboard(new Repo(),A,new Date("2026-08-15"));expect(d.trips.map(t=>t.id)).toEqual(["ta"]);expect(d.events.map(e=>e.bookingId)).toEqual(["ba"]);expect(JSON.stringify(d)).not.toContain("B Event");});});

describe("manager dashboard aggregate", () => {
  const trip = {
    id: "trip-a", travelLegId: A, name: "A Trip",
    startDate: new Date("2026-08-15"), endDate: new Date("2026-08-20"),
    startLabel: "A", startLatitude: null, startLongitude: null,
    endLabel: "B", endLatitude: null, endLongitude: null,
    legName: "A", legColor: "#f97316",
  };
  const stop = (bookingId: string, startsAt: string, status = "confirmed", probability: string | null = null) => ({
    id: `stop-${bookingId}`, tripId: trip.id, bookingId, sortOrder: 1,
    bookingName: bookingId, city: "A City", region: "ND",
    latitude: null, longitude: null, startsAt: new Date(startsAt),
    endsAt: new Date(startsAt), status, probability,
  });

  function dependencies(overrides: Partial<LegManagerDashboardDependencies> = {}): LegManagerDashboardDependencies {
    return {
      tripRepository: {
        async listTrips() { return [trip]; },
        async listStops() { return [stop("trip-booking", "2026-08-16T12:00:00Z"), stop("potential-stop", "2026-08-17T12:00:00Z", "pending_contract", "likely")]; },
        async listSegments() { return []; },
      },
      bookingRepository: {
        async listForLeg() {
          return [{
            bookingId: "direct-booking", bookingName: "Direct booking", city: "B City", region: "ND",
            latitude: null, longitude: null, startsAt: new Date("2026-08-15T12:00:00Z"),
            endsAt: new Date("2026-08-15T20:00:00Z"), status: "pending_contract", probability: "definite",
            legName: "A", legColor: "#f97316",
          }];
        },
      },
      lifecycleRepository: {
        async getCurrentForLeg() { return { bookingId: "trip-booking", checkedInAt: new Date("2026-08-16T13:00:00Z") } as any; },
        async listIncompleteForLeg() { return [{ bookingId: "wrap-up-booking", bookingName: "Wrap-up", city: "A City", region: "ND" }] as any; },
      },
      reviewRepository: {
        async listBookingsForLeg() { return [{ id: "review-booking", travelLegId: A, name: "Review", startsAt: new Date("2026-08-10"), endsAt: new Date("2026-08-11") }]; },
        async listReviewsForLeg() { return []; },
        async bookingBelongsToLeg() { return true; },
        async findByMutation() { return null; },
        async insertReview() { return {}; },
        async listReviewsForBooking() { return []; },
      },
      financeRepository: { async summary() { return { expenseTotalCents: 125 }; } },
      ...overrides,
    };
  }

  it("returns one canonical booked queue plus lifecycle, review, wrap-up, and summary sections", async () => {
    const dashboard = await loadLegManagerDashboard(dependencies(), A, new Date("2026-08-15T00:00:00Z"));

    expect(dashboard.events.map((event) => event.bookingId)).toEqual(["direct-booking", "trip-booking"]);
    expect(dashboard.events.every((event) => event.scheduleState === "booked")).toBe(true);
    expect(dashboard.currentLifecycle?.bookingId).toBe("trip-booking");
    expect(dashboard.incompleteWrapUps).toHaveLength(1);
    expect(dashboard.reviewsDue).toHaveLength(1);
    expect(dashboard.money).toEqual({ expenseTotalCents: 125 });
    expect(dashboard.summary).toEqual({
      upcomingBookedEventsCount: 2,
      incompleteWrapUpsCount: 1,
      reviewsDueCount: 1,
    });
  });

  it("returns available queue data with an explicit partial error when a secondary section fails", async () => {
    const dashboard = await loadLegManagerDashboard(dependencies({
      financeRepository: { async summary() { throw new Error("Finance unavailable"); } },
    }), A, new Date("2026-08-15T00:00:00Z"));

    expect(dashboard.events).toHaveLength(2);
    expect(dashboard.money).toEqual({});
    expect(dashboard.partialErrors).toEqual([{ section: "money", message: "Finance unavailable" }]);
  });
});
