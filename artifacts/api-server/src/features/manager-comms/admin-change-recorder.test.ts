import { describe, expect, it, vi } from "vitest";
import { recordMeetupApprovalAcknowledgment } from "./admin-change-recorder";

describe("recordMeetupApprovalAcknowledgment", () => {
  it("creates one grouped acknowledgment for both affected legs after official meetup approval", async () => {
    const acknowledgments = { recordAdminOperationalChange: vi.fn(async (input:any) => input) };
    await recordMeetupApprovalAcknowledgment(acknowledgments as any, {
      requestId: "00000000-0000-4000-8000-000000000701",
      handoffId: "00000000-0000-4000-8000-000000000702",
      fromLegId: "00000000-0000-4000-8000-0000000000a1",
      toLegId: "00000000-0000-4000-8000-0000000000b2",
      resourceName: "Paintball Trailer",
      meetupLabel: "Dickinson",
      windowStartsAt: new Date("2026-08-20T19:00:00Z"),
      windowEndsAt: new Date("2026-08-20T21:00:00Z"),
      adminActor: "Admin",
    });

    expect(acknowledgments.recordAdminOperationalChange).toHaveBeenCalledWith(expect.objectContaining({
      actionId: "00000000-0000-4000-8000-000000000701",
      legIds: ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b2"],
      sourceType: "equipment_handoff",
      sourceId: "00000000-0000-4000-8000-000000000702",
      title: "Equipment meetup approved",
      items: expect.arrayContaining([
        expect.objectContaining({ label: "Equipment", afterValue: "Paintball Trailer" }),
        expect.objectContaining({ label: "Meetup", afterValue: "Dickinson" }),
      ]),
    }));
  });
});
