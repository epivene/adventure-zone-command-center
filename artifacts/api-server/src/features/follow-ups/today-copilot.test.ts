import { describe, expect, it } from "vitest";

import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import type { FollowUpPlanItem, FollowUpSummary } from "./today-query";
import {
  explainFollowUpAction,
  explainFollowUpPlanAction,
} from "./today-copilot";

const now = new Date("2026-08-18T18:00:00.000Z");

function followUp(overrides: Partial<FollowUpSummary> = {}): FollowUpSummary {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: "20000000-0000-4000-8000-000000000001",
    bookingId: "30000000-0000-4000-8000-000000000001",
    bookingName: "River Days",
    contactName: "Sam Organizer",
    organizationName: "River Days Committee",
    bookingStatus: "contacted",
    routeLeg: null,
    lastContactedAt: new Date("2026-08-01T18:00:00.000Z"),
    kind: "call",
    dueAt: new Date("2026-08-18T17:00:00.000Z"),
    createdAt: new Date("2026-08-01T18:00:00.000Z"),
    status: "due",
    probability: "possible",
    operations: null,
    ...overrides,
  };
}

function planItem(overrides: Partial<FollowUpPlanItem> = {}): FollowUpPlanItem {
  return {
    id: "30000000-0000-4000-8000-000000000002",
    organizationId: "10000000-0000-4000-8000-000000000002",
    primaryContactId: "20000000-0000-4000-8000-000000000002",
    name: "County Fair",
    status: "new_lead",
    probability: "possible",
    planReason: "needs_action",
    operations: null,
    ...overrides,
  };
}

describe("Booking Copilot next-action explanations", () => {
  it("marks an overdue follow-up urgent and explains why", () => {
    const result = explainFollowUpAction(
      followUp({ dueAt: new Date("2026-08-15T18:00:00.000Z") }),
      now,
    );

    expect(result.priority).toBe("urgent");
    expect(result.headline.toLowerCase()).toContain("overdue");
    expect(result.reasons.join(" ").toLowerCase()).toContain("overdue");
  });

  it("makes a due-today follow-up high priority", () => {
    const result = explainFollowUpAction(followUp(), now);

    expect(result.priority).toBe("high");
    expect(result.reasons.join(" ").toLowerCase()).toContain("today");
  });

  it("surfaces pending contract and likely opportunity signals", () => {
    const result = explainFollowUpAction(
      followUp({
        dueAt: new Date("2026-08-25T18:00:00.000Z"),
        bookingStatus: "pending_contract",
        status: "deadline",
        probability: "likely",
      }),
      now,
    );

    expect(result.priority).toBe("high");
    expect(result.reasons.join(" ")).toContain("Contract");
    expect(result.reasons.join(" ")).toContain("Likely");
  });

  it("explains a quiet lead without making it urgent", () => {
    const result = explainFollowUpAction(
      followUp({
        dueAt: new Date("2026-08-25T18:00:00.000Z"),
        status: "quiet_lead",
      }),
      now,
    );

    expect(result.priority).toBe("normal");
    expect(result.reasons.join(" ").toLowerCase()).toContain("quiet");
  });

  it("adds route-review context from existing operations warnings", () => {
    const operations: BookingOperationsSummary = {
      packageNames: [],
      sharedAttractionTotal: null,
      pendingRequestCount: 0,
      leg: null,
      warnings: [
        {
          id: "route-warning",
          kind: "route",
          severity: "warning",
          message: "Route needs review",
          href: "/routes",
        },
      ],
    };

    const result = explainFollowUpAction(
      followUp({
        dueAt: new Date("2026-08-25T18:00:00.000Z"),
        operations,
      }),
      now,
    );

    expect(result.reasons.join(" ")).toContain("Route needs review");
  });

  it("explains why an unplanned lead is on Today", () => {
    const result = explainFollowUpPlanAction(planItem());

    expect(result.priority).toBe("normal");
    expect(result.reasons.join(" ").toLowerCase()).toContain("no future follow-up");
  });

  it("raises likely unplanned opportunities and post-event work", () => {
    const likely = explainFollowUpPlanAction(
      planItem({ probability: "likely" }),
    );
    const postEvent = explainFollowUpPlanAction(
      planItem({ status: "confirmed", planReason: "post_event" }),
    );

    expect(likely.priority).toBe("high");
    expect(likely.reasons.join(" ")).toContain("Likely");
    expect(postEvent.priority).toBe("high");
    expect(postEvent.reasons.join(" ").toLowerCase()).toContain("past event");
  });
});
