import { describe, expect, it } from "vitest";

import {
  BLANDING_2026_GMAIL,
  correctBlandingKristyState,
  type BlandingKristyStateCorrectionRepository,
  type BlandingStateInspection,
} from "./blanding-kristy-state-correction";

const kristyLeg = {
  legId: "00000000-0000-4000-8000-000000000010",
  managerName: "Kristy",
  legName: "Kristy",
};

const blanding: BlandingStateInspection = {
  bookingId: "00000000-0000-4000-8000-000000000020",
  organizationId: "00000000-0000-4000-8000-000000000030",
  bookingName: "Blanding City Fall Festival",
  city: "Blanding",
  region: "UT",
  startsAt: new Date("2026-09-10T00:00:00.000Z"),
  endsAt: new Date("2026-09-14T00:00:00.000Z"),
  status: "contract_received",
  probability: "definite",
  assignedLegId: null,
  latitude: null,
  longitude: null,
  gmailThreadLinked: false,
  contacts: [],
};

class FakeRepository implements BlandingKristyStateCorrectionRepository {
  applied: Parameters<BlandingKristyStateCorrectionRepository["applyCorrection"]>[0] | null = null;

  constructor(
    public legs = [kristyLeg],
    public bookings = [blanding],
    private readonly result: "applied" | "already_current" | "changed" = "applied",
  ) {}

  async findKristyLegs() {
    return this.legs;
  }

  async inspectBlanding2026() {
    return this.bookings;
  }

  async applyCorrection(input: Parameters<BlandingKristyStateCorrectionRepository["applyCorrection"]>[0]) {
    this.applied = input;
    return this.result;
  }
}

describe("correctBlandingKristyState", () => {
  it("assigns the exact confirmed Blanding event to Kristy and links its Gmail thread and contacts", async () => {
    const repository = new FakeRepository();

    await expect(correctBlandingKristyState(repository)).resolves.toEqual({
      status: "applied",
      bookingId: blanding.bookingId,
      organizationId: blanding.organizationId,
      legId: kristyLeg.legId,
      gmailThreadId: "19d214e0a6d3f255",
      contacts: ["amitchell@sanjuancc.org", "ssherrow@sanjuancc.org"],
      mapReady: true,
    });

    expect(repository.applied).toEqual({
      expected: blanding,
      legId: kristyLeg.legId,
      gmail: BLANDING_2026_GMAIL,
      contacts: [
        { firstName: "Alyn", lastName: "Mitchell", email: "amitchell@sanjuancc.org" },
        { firstName: "Shauna", lastName: "Sherrow", email: "ssherrow@sanjuancc.org" },
      ],
      coordinates: { latitude: 37.6242, longitude: -109.4782 },
      reason: "Owner confirmed Blanding belongs to Kristy's leg and its Adventure Zone Gmail history belongs on the event profile.",
    });
  });

  it("refuses to guess when more than one Blanding booking matches", async () => {
    const repository = new FakeRepository(
      [kristyLeg],
      [blanding, { ...blanding, bookingId: "00000000-0000-4000-8000-000000000099" }],
    );

    await expect(correctBlandingKristyState(repository)).resolves.toMatchObject({
      status: "skipped",
      reason: "booking_ambiguous",
    });
    expect(repository.applied).toBeNull();
  });

  it("reports already-current state without weakening the exact identity guard", async () => {
    const repository = new FakeRepository(
      [kristyLeg],
      [{
        ...blanding,
        status: "confirmed",
        assignedLegId: kristyLeg.legId,
        latitude: 37.6242,
        longitude: -109.4782,
        gmailThreadLinked: true,
        contacts: ["amitchell@sanjuancc.org", "ssherrow@sanjuancc.org"],
      }],
      "already_current",
    );

    await expect(correctBlandingKristyState(repository)).resolves.toMatchObject({
      status: "already_current",
      bookingId: blanding.bookingId,
      legId: kristyLeg.legId,
      mapReady: true,
    });
  });
});
