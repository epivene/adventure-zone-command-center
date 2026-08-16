import { describe, expect, it, vi } from "vitest";
import { HandoffRepository } from "./handoff-repository";

function fakeDb(results: unknown[]) {
  return {
    execute: vi.fn(async () => results.shift() ?? { rows: [] }),
  } as any;
}

const baseRow = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "approved",
  fromLegId: "00000000-0000-4000-8000-000000000010",
  toLegId: "00000000-0000-4000-8000-000000000020",
  fromLegName: "Kristy",
  toLegName: "Hulk",
  fromParticipantKind: "leg",
  toParticipantKind: "leg",
  fromExternalContactId: null,
  fromExternalName: null,
  fromExternalPhone: null,
  fromExternalEmail: null,
  toExternalContactId: null,
  toExternalName: null,
  toExternalPhone: null,
  toExternalEmail: null,
  fromTripId: null,
  toTripId: null,
  resourceId: "00000000-0000-4000-8000-000000000030",
  resourceCode: "PB",
  resourceName: "Paintball trailer",
  meetupLabel: "Billings transfer",
  meetupLatitude: 45.7833,
  meetupLongitude: -108.5007,
  windowStartsAt: new Date("2026-08-20T12:00:00Z"),
  windowEndsAt: new Date("2026-08-20T14:00:00Z"),
  directMiles: null,
  directMinutes: null,
  fromDetourMiles: 0,
  fromDetourMinutes: 0,
  toDetourMiles: 0,
  toDetourMinutes: 0,
  combinedDetourMiles: 0,
  availableBufferMinutes: 120,
  opportunityBand: "possible",
  explanation: "Manual equipment meetup.",
  dependencyFingerprint: "manual:test",
  approvedAt: new Date("2026-08-15T00:00:00Z"),
  dismissedAt: null,
};

describe("HandoffRepository participant model", () => {
  it("reads an existing leg-to-leg handoff as two leg participants", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [baseRow] }]);
    const repository = new HandoffRepository(db);

    const handoff = await repository.get(baseRow.id);

    expect(handoff?.fromParticipant).toEqual({
      kind: "leg",
      legId: baseRow.fromLegId,
      legName: "Kristy",
    });
    expect(handoff?.toParticipant).toEqual({
      kind: "leg",
      legId: baseRow.toLegId,
      legName: "Hulk",
    });
  });

  it("stores an outside-runner handoff without creating a fake leg", async () => {
    const externalRow = {
      ...baseRow,
      toLegId: null,
      toLegName: null,
      toParticipantKind: "external_contact",
      toExternalName: "Jordan Smith",
      toExternalPhone: "555-0100",
    };
    const db = fakeDb([
      { rows: [] },
      { rows: [{ id: baseRow.id }] },
      { rows: [] },
      { rows: [externalRow] },
    ]);
    const repository = new HandoffRepository(db);

    const saved = await repository.createManual({
      fromParticipant: { kind: "leg", legId: baseRow.fromLegId },
      toParticipant: {
        kind: "external_contact",
        externalContactId: null,
        displayName: "Jordan Smith",
        phone: "555-0100",
        email: null,
      },
      fromTripId: null,
      toTripId: null,
      resourceId: baseRow.resourceId,
      meetupLabel: baseRow.meetupLabel,
      meetupLatitude: baseRow.meetupLatitude,
      meetupLongitude: baseRow.meetupLongitude,
      windowStartsAt: baseRow.windowStartsAt,
      windowEndsAt: baseRow.windowEndsAt,
    });

    expect(saved.toLegId).toBeNull();
    expect(saved.toParticipant).toEqual({
      kind: "external_contact",
      externalContactId: null,
      displayName: "Jordan Smith",
      phone: "555-0100",
      email: null,
    });
  });

  it("rejects a meetup with no Adventure Zone leg participant", async () => {
    const repository = new HandoffRepository(fakeDb([]));
    const external = {
      kind: "external_contact" as const,
      externalContactId: null,
      displayName: "Outside runner",
      phone: null,
      email: null,
    };

    await expect(repository.createManual({
      fromParticipant: external,
      toParticipant: { ...external, displayName: "Second runner" },
      fromTripId: null,
      toTripId: null,
      resourceId: baseRow.resourceId,
      meetupLabel: baseRow.meetupLabel,
      meetupLatitude: baseRow.meetupLatitude,
      meetupLongitude: baseRow.meetupLongitude,
      windowStartsAt: baseRow.windowStartsAt,
      windowEndsAt: baseRow.windowEndsAt,
    })).rejects.toThrow(/Adventure Zone leg/i);
  });
});
