import { describe, expect, it } from "vitest";
import { coerceBookingDetailPayload } from "./BookingDetailPage";

describe("BookingDetailPage API coercion", () => {
  it("converts timeline date strings to Date instances before ActivityTimeline renders", () => {
    const payload = coerceBookingDetailPayload({
      booking: { id: "booking-1", name: "Current booking" },
      followUps: [],
      timeline: [
        {
          id: "activity-1",
          kind: "note",
          body: "Imported note",
          occurredAt: "2026-08-18T01:00:00.000Z",
          createdAt: "2026-08-18T01:00:00.000Z",
          updatedAt: "2026-08-18T01:05:00.000Z",
        },
      ],
    } as any);

    expect(payload.timeline[0].occurredAt).toBeInstanceOf(Date);
    expect(payload.timeline[0].createdAt).toBeInstanceOf(Date);
    expect(payload.timeline[0].updatedAt).toBeInstanceOf(Date);
  });
});
