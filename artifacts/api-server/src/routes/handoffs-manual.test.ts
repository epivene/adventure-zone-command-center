import { describe, expect, it } from "vitest";
import { manualHandoffSchema } from "./handoffs";

const leg = { kind: "leg" as const, legId: "00000000-0000-4000-8000-000000000010" };
const external = { kind: "external_contact" as const, externalContactId: null, displayName: "Jordan Smith", phone: "555-0100", email: null };
const base = {
  fromParticipant: leg,
  toParticipant: external,
  fromTripId: null,
  toTripId: null,
  resourceId: "00000000-0000-4000-8000-000000000020",
  meetupLabel: "Billings transfer",
  meetupLatitude: 45.7833,
  meetupLongitude: -108.5007,
  windowStartsAt: "2026-08-20T12:00:00Z",
  windowEndsAt: "2026-08-20T14:00:00Z",
};

describe("manualHandoffSchema", () => {
  it("accepts a leg meeting an outside runner", () => {
    expect(manualHandoffSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an outside runner with no name", () => {
    const parsed = manualHandoffSchema.safeParse({ ...base, toParticipant: { ...external, displayName: "" } });
    expect(parsed.success).toBe(false);
  });

  it("rejects a meetup with two outside participants", () => {
    const parsed = manualHandoffSchema.safeParse({ ...base, fromParticipant: { ...external, displayName: "Runner A" }, toParticipant: { ...external, displayName: "Runner B" } });
    expect(parsed.success).toBe(false);
  });
});
