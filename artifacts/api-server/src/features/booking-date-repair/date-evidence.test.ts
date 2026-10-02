import { describe, expect, it } from "vitest";
import * as dates from "./date-evidence";
const empty = { bookingId: "one", rawPublic: { start: null, end: null }, rawReservation: { start: null, end: null }, evidence: [] };
const endpoint = (field: dates.EndpointEvidence["field"], value: string, kind: dates.EvidenceKind = "verified_event", semantics: dates.EndpointEvidence["semantics"] = "instant", revision = 1) => ({ field, value, kind, semantics, revision, sourceRef: { type: "manual", id: "saved-source", revision: String(revision) } });
describe("booking date evidence", () => {
  it("does not interpret imported sales milestones or a sentinel as event dates", () => {
    expect(dates.resolveBookingDates({ ...empty, rawPublic: { start: "2026-03-01T00:00:00Z", end: "9999-12-31T00:00:00Z" },
      evidence: [endpoint("public_start", "2026-03-01T00:00:00Z", "sales_milestone")] }).publicWindow).toBeNull();
  });
  it("keeps incomplete public dates unresolved rather than inventing a one-day event", () => {
    const result = dates.resolveBookingDates({ ...empty, rawPublic: { start: "2027-04-03T00:00:00Z", end: null },
      evidence: [endpoint("public_start", "2027-04-03T00:00:00Z")] });
    expect(result.publicWindow).toBeNull();
    expect(result.reviewReasons).toContain("INCOMPLETE_PUBLIC_WINDOW");
  });
  it("accepts current verified manual endpoints despite old ACT sales evidence", () => {
    const start = "2027-04-03T00:00:00Z", end = "2027-04-04T00:00:00Z";
    expect(dates.resolveBookingDates({ ...empty, rawPublic: { start, end }, evidence: [
      endpoint("public_start", "2026-02-01T00:00:00Z", "sales_milestone"),
      endpoint("public_start", start, "verified_event", "instant", 2), endpoint("public_end", end, "verified_event", "instant", 2),
    ] }).publicWindow).toEqual({ start: "2027-04-03T00:00:00.000Z", end: "2027-04-04T00:00:00.000Z" });
  });
  it("preserves a verified cross-year public window and a longer operational window separately", () => {
    const start = "2026-12-31T07:00:00Z", end = "2027-01-02T07:00:00Z";
    const reservedStart = "2026-12-30T07:00:00Z", reservedEnd = "2027-01-03T07:00:00Z";
    const result = dates.resolveBookingDates({ ...empty, rawPublic: { start, end }, rawReservation: { start: reservedStart, end: reservedEnd },
      evidence: [endpoint("public_start", start), endpoint("public_end", end), endpoint("reservation_start", reservedStart, "verified_reservation"), endpoint("reservation_end", reservedEnd, "verified_reservation")] });
    expect(result.publicWindow).toEqual({ start: "2026-12-31T07:00:00.000Z", end: "2027-01-02T07:00:00.000Z" });
    expect(result.reservationWindow).toEqual({ start: "2026-12-30T07:00:00.000Z", end: "2027-01-03T07:00:00.000Z" });
    expect(result.evidenceState).toBe("verified");
  });
  it.each(["9999-12-31", "2027-02-29", "2027-13-01", "not-a-date"])("rejects impossible endpoint %s", value => {
    expect(dates.resolveBookingDates({ ...empty, rawPublic: { start: value, end: value }, evidence: [endpoint("public_start", value), endpoint("public_end", value)] }).publicWindow).toBeNull();
  });
  it("rejects reversed verified endpoints", () => {
    const start = "2027-07-10T00:00:00Z", end = "2027-07-09T00:00:00Z";
    expect(dates.resolveBookingDates({ ...empty, rawPublic: { start, end }, evidence: [endpoint("public_start", start), endpoint("public_end", end)] }).reviewReasons).toContain("REVERSED_PUBLIC_WINDOW");
  });
  it("preserves Google exclusive-end semantics across Denver spring DST", () => {
    const start = "2027-03-13", end = "2027-03-15";
    const result = dates.resolveBookingDates({ ...empty, rawReservation: { start: "2027-03-13T07:00:00Z", end: "2027-03-15T06:00:00Z" },
      evidence: [endpoint("reservation_start", start, "verified_reservation", "inclusive_date"), endpoint("reservation_end", end, "verified_reservation", "exclusive_date")] });
    expect(result.reservationWindow).toEqual({ start: "2027-03-13T07:00:00.000Z", end: "2027-03-15T06:00:00.000Z" });
  });
  it("does not resolve a same-revision source conflict by array ordering", () => {
    const start = "2027-07-01T00:00:00Z", end = "2027-07-02T00:00:00Z";
    const evidence = [endpoint("public_start", start), endpoint("public_start", "2027-07-03T00:00:00Z"), endpoint("public_end", end)];
    expect(dates.resolveBookingDates({ ...empty, rawPublic: { start, end }, evidence }).publicWindow).toBeNull();
    expect(dates.resolveBookingDates({ ...empty, rawPublic: { start, end }, evidence: [...evidence].reverse() }).publicWindow).toBeNull();
  });
});
