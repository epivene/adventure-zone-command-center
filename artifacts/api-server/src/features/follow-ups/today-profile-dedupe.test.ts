import { describe, expect, it } from "vitest";
import type { FollowUpSummary } from "./today-query";
import { dedupeFollowUpsByBooking } from "./today-copilot";

function item(id: string, dueAt: string): FollowUpSummary {
  return {
    id,
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: "20000000-0000-4000-8000-000000000001",
    bookingId: "30000000-0000-4000-8000-000000000001",
    bookingName: "Moab Music Festival and the Labor Day Community Concert",
    contactName: "Organizer",
    organizationName: "Moab Music Festival",
    bookingStatus: "contacted",
    routeLeg: null,
    lastContactedAt: null,
    kind: "call",
    dueAt: new Date(dueAt),
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    status: "due",
    probability: "possible",
    operations: null,
  };
}

describe("dedupeFollowUpsByBooking", () => {
  it("keeps one current action per booking and preserves unlinked follow-ups", () => {
    const duplicateLater = item("40000000-0000-4000-8000-000000000002", "2026-08-30T12:00:00.000Z");
    const duplicateSooner = item("40000000-0000-4000-8000-000000000001", "2026-08-28T12:00:00.000Z");
    const unlinked = { ...item("40000000-0000-4000-8000-000000000003", "2026-08-29T12:00:00.000Z"), bookingId: null };

    const result = dedupeFollowUpsByBooking([duplicateLater, duplicateSooner, unlinked]);

    expect(result.map((followUp) => followUp.id)).toEqual([
      duplicateSooner.id,
      unlinked.id,
    ]);
  });
});
