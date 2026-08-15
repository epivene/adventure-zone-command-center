import { describe, expect, it } from "vitest";
import {
  createReviewForManager,
  listDueReviewsForManager,
  summarizeReviewHistory,
  type EventReviewStore,
} from "./event-review-repository";

function fakeStore(): EventReviewStore & { reviews: any[] } {
  const reviews: any[] = [];
  const bookings = [
    { id: "booking-a", travelLegId: "leg-a", name: "Old Fair", startsAt: new Date("2026-08-13T16:00:00Z"), endsAt: new Date("2026-08-14T22:00:00Z") },
    { id: "booking-b", travelLegId: "leg-b", name: "Other Fair", startsAt: new Date("2026-08-13T16:00:00Z"), endsAt: new Date("2026-08-14T22:00:00Z") },
    { id: "booking-future", travelLegId: "leg-a", name: "Tomorrow", startsAt: new Date("2026-08-16T16:00:00Z"), endsAt: null },
  ];
  return {
    reviews,
    async listBookingsForLeg(legId) { return bookings.filter((b) => b.travelLegId === legId); },
    async listReviewsForLeg(legId) { return reviews.filter((r) => r.legId === legId); },
    async bookingBelongsToLeg(bookingId, legId) { return bookings.some((b) => b.id === bookingId && b.travelLegId === legId); },
    async findByMutation(legId, clientMutationId) { return reviews.find((r) => r.legId === legId && r.clientMutationId === clientMutationId) ?? null; },
    async insertReview(input) { const row = { id: `review-${reviews.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...input }; reviews.push(row); return row; },
    async listReviewsForBooking(bookingId) { return reviews.filter((r) => r.bookingId === bookingId); },
  };
}

const now = new Date("2026-08-15T18:00:00Z");

describe("event review repository", () => {
  it("lists only due events for the manager's leg", async () => {
    const due = await listDueReviewsForManager(fakeStore(), "leg-a", now);
    expect(due.map((booking) => booking.id)).toEqual(["booking-a"]);
  });

  it("rejects reviewing another leg's booking", async () => {
    const result = await createReviewForManager(fakeStore(), "leg-a", {
      bookingId: "booking-b", rating: 4, feedback: "Nope", organizerSiteNotes: null,
      crewNotes: null, recommendReturn: "unsure", clientMutationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("keeps historical rows and derives their average", async () => {
    const store = fakeStore();
    await createReviewForManager(store, "leg-a", { bookingId: "booking-a", rating: 5, feedback: "Great", organizerSiteNotes: null, crewNotes: null, recommendReturn: "yes", clientMutationId: "00000000-0000-4000-8000-000000000002" });
    await createReviewForManager(store, "leg-a", { bookingId: "booking-a", rating: 3, feedback: "Okay", organizerSiteNotes: null, crewNotes: null, recommendReturn: "unsure", clientMutationId: "00000000-0000-4000-8000-000000000003" });
    const summary = await summarizeReviewHistory(store, "booking-a");
    expect(summary.reviews).toHaveLength(2);
    expect(summary.averageRating).toBe(4);
  });
});
