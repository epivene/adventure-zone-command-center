import { describe, expect, it } from "vitest";

import { completeCallInputSchema } from "@/features/calls/call-input";

const organizationId = "11111111-1111-4111-8111-111111111111";

function validInput() {
  return {
    requestKey: "99999999-9999-4999-8999-999999999999",
    organizationId,
    contactId: null,
    bookingId: null,
    followUpId: null,
    note: "  Confirmed the county fair date.  ",
    disposition: "interested" as const,
    resultingBookingStatus: null,
    startedAt: new Date("2026-08-01T15:00:00.000Z"),
    endedAt: new Date("2026-08-01T15:10:00.000Z"),
    nextAction: { kind: "  send quote  ", dueAt: new Date("2026-08-02T15:00:00.000Z") },
    lastResortReason: null,
    lastResortConfirmed: false,
    approvedContactUpdates: null,
    approvedBookingUpdates: null,
  };
}

describe("completeCallInputSchema", () => {
  it("normalizes the note and next action that are saved with a completed call", () => {
    expect(completeCallInputSchema.parse(validInput())).toMatchObject({
      note: "Confirmed the county fair date.",
      nextAction: { kind: "send quote" },
    });
  });

  it("accepts a call without an organization so local booking and contact history can be preserved", () => {
    expect(completeCallInputSchema.parse({
      ...validInput(),
      organizationId: null,
      bookingId: "33333333-3333-4333-8333-333333333333",
    })).toMatchObject({ organizationId: null });
  });

  it("requires a parent record before a call can be submitted", () => {
    const result = completeCallInputSchema.safeParse({
      ...validInput(),
      organizationId: null,
      contactId: null,
      bookingId: null,
      followUpId: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["organizationId"],
        message: "Link this call to an organization, contact, booking, or follow-up.",
      }),
    ]));
  });

  it("rejects a call whose end precedes its start", () => {
    const result = completeCallInputSchema.safeParse({
      ...validInput(),
      endedAt: new Date("2026-08-01T14:59:59.000Z"),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["endedAt"],
          message: "Call end must be after the start.",
        }),
      ]),
    );
  });

  it("requires a Last Resort reason and explicit confirmation only for the Last Resort disposition", () => {
    const missingReason = completeCallInputSchema.safeParse({
      ...validInput(),
      disposition: "move_to_last_resort",
      nextAction: null,
    });

    expect(missingReason.success).toBe(false);
    if (missingReason.success) return;
    expect(missingReason.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["lastResortReason"],
          message: "Add a Last Resort reason",
        }),
      ]),
    );

    const missingConfirmation = completeCallInputSchema.safeParse({
      ...validInput(),
      disposition: "move_to_last_resort",
      nextAction: null,
      lastResortReason: "Repeated cancellations.",
    });
    expect(missingConfirmation.success).toBe(false);
    if (missingConfirmation.success) return;
    expect(missingConfirmation.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["lastResortConfirmed"],
          message: "Confirm moving this organization to Last Resort",
        }),
      ]),
    );
  });

  it("enforces the canonical 2,000-character Last Resort reason bound", () => {
    expect(completeCallInputSchema.safeParse({
      ...validInput(),
      disposition: "move_to_last_resort",
      nextAction: null,
      lastResortReason: "x".repeat(2_000),
      lastResortConfirmed: true,
    }).success).toBe(true);

    const tooLong = completeCallInputSchema.safeParse({
      ...validInput(),
      disposition: "move_to_last_resort",
      nextAction: null,
      lastResortReason: "x".repeat(2_001),
      lastResortConfirmed: true,
    });
    expect(tooLong.success).toBe(false);
    if (tooLong.success) return;
    expect(tooLong.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["lastResortReason"] }),
    ]));
  });

  it("requires a UUID request key for database-boundary replay protection", () => {
    const result = completeCallInputSchema.safeParse({
      ...validInput(),
      requestKey: "not-a-uuid",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["requestKey"] }),
    ]));
  });
});
