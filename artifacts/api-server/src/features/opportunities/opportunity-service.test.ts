import { describe, expect, it } from "vitest";

import type {
  AuditEntry,
  Booking,
  BookingRepository,
  BookingTransaction,
  CreateFollowUpInput,
  FollowUp,
  UpdateBookingStatusInput,
} from "@/features/bookings/booking-repository";
import { BookingService } from "@/features/bookings/booking-service";
import {
  deriveOpportunityTransition,
  OpportunityService,
} from "./opportunity-service";

const BOOKING_ID = "10000000-0000-4000-8000-000000000001";
const FOLLOW_UP_ID = "20000000-0000-4000-8000-000000000001";
const NEXT_FOLLOW_UP_ID = "20000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-26T15:00:00.000Z");
const NEXT_DUE_AT = new Date("2026-09-02T15:00:00.000Z");

type OpportunityState = {
  id: string;
  status: "contacted" | "follow_up";
  nextActionKind: string | null;
  nextActionDueAt: Date | null;
};

type MemoryState = {
  booking: Booking;
  followUps: Map<string, FollowUp>;
  opportunity: OpportunityState;
};

function cloneFollowUp(value: FollowUp): FollowUp {
  return {
    ...value,
    dueAt: new Date(value.dueAt),
    completedAt: value.completedAt ? new Date(value.completedAt) : null,
  };
}

function cloneState(value: MemoryState): MemoryState {
  return {
    booking: { ...value.booking },
    followUps: new Map(
      [...value.followUps].map(([id, followUp]) => [id, cloneFollowUp(followUp)]),
    ),
    opportunity: {
      ...value.opportunity,
      nextActionDueAt: value.opportunity.nextActionDueAt
        ? new Date(value.opportunity.nextActionDueAt)
        : null,
    },
  };
}

class MemoryBookingRepository implements BookingRepository {
  state: MemoryState = {
    booking: {
      id: BOOKING_ID,
      name: "Annual Community Fair",
      city: "Sample City",
      region: "CO",
      status: "new_lead",
      probability: "possible",
    },
    followUps: new Map([
      [
        FOLLOW_UP_ID,
        {
          id: FOLLOW_UP_ID,
          bookingId: BOOKING_ID,
          kind: "email",
          dueAt: NOW,
          completedAt: null,
          outcome: null,
          nextFollowUpId: null,
        },
      ],
    ]),
    opportunity: {
      id: OPPORTUNITY_ID,
      status: "contacted",
      nextActionKind: "email",
      nextActionDueAt: NOW,
    },
  };

  failFutureFollowUpCreation = false;

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    return { id: BOOKING_ID, ...input };
  }

  async transaction<T>(
    operation: (transaction: BookingTransaction) => Promise<T>,
  ): Promise<T> {
    const working = cloneState(this.state);
    const transaction: BookingTransaction = {
      findFollowUpWithBookingForUpdate: async (followUpId) => {
        const followUp = working.followUps.get(followUpId);
        return followUp
          ? { followUp: cloneFollowUp(followUp), booking: { ...working.booking } }
          : null;
      },
      findOpportunityForUpdate: async (opportunityId) =>
        opportunityId === working.opportunity.id
          ? { id: working.opportunity.id, status: working.opportunity.status }
          : null,
      createBooking: async (input) => ({ id: BOOKING_ID, ...input }),
      completeFollowUp: async (followUpId, input) => {
        const current = working.followUps.get(followUpId);
        if (!current) throw new Error("Follow-up is missing.");
        const completed = {
          ...current,
          outcome: input.outcome,
          completedAt: input.completedAt,
        };
        working.followUps.set(followUpId, completed);
        return cloneFollowUp(completed);
      },
      createFollowUp: async (input: CreateFollowUpInput) => {
        if (this.failFutureFollowUpCreation) {
          throw new Error("future follow-up creation failed");
        }
        const followUp: FollowUp = {
          id: NEXT_FOLLOW_UP_ID,
          bookingId: input.bookingId,
          kind: input.kind,
          dueAt: input.dueAt,
          completedAt: null,
          outcome: null,
          nextFollowUpId: null,
        };
        working.followUps.set(followUp.id, followUp);
        return cloneFollowUp(followUp);
      },
      linkNextFollowUp: async (followUpId, nextFollowUpId) => {
        const current = working.followUps.get(followUpId);
        if (!current) throw new Error("Follow-up is missing.");
        working.followUps.set(followUpId, { ...current, nextFollowUpId });
      },
      updateBookingStatus: async (input: UpdateBookingStatusInput) => {
        working.booking = { ...working.booking, status: input.status };
        return { ...working.booking };
      },
      updateOpportunityFollowUp: async (input) => {
        if (input.opportunityId !== working.opportunity.id) {
          throw new Error("Opportunity is missing.");
        }
        working.opportunity = {
          ...working.opportunity,
          status: "follow_up",
          nextActionKind: input.nextActionKind,
          nextActionDueAt: input.nextActionDueAt,
        };
      },
      createAuditEntry: async (_input: AuditEntry) => undefined,
    };

    try {
      const result = await operation(transaction);
      this.state = working;
      return result;
    } catch (error) {
      throw error;
    }
  }
}

describe("deriveOpportunityTransition", () => {
  it.each([
    ["new_lead", { kind: "research_started" }, "researching"],
    ["researching", { kind: "ready_checks_complete" }, "ready_to_contact"],
    ["ready_to_contact", { kind: "first_contact_completed" }, "contacted"],
    [
      "contacted",
      { kind: "follow_up_created", dueAt: NEXT_DUE_AT },
      "follow_up",
    ],
    ["interested", { kind: "booking_started" }, "booking_in_progress"],
    ["booking_in_progress", { kind: "booking_confirmed" }, "booked"],
  ] as const)("applies the authoritative %s transition", (current, event, status) => {
    expect(deriveOpportunityTransition(current, event)).toEqual({
      appliedStatus: status,
      suggestedStatus: null,
    });
  });

  it("suggests subjective interest instead of forcing it", () => {
    expect(
      deriveOpportunityTransition("follow_up", { kind: "positive_response" }),
    ).toEqual({
      appliedStatus: null,
      suggestedStatus: "interested",
    });
  });
});

describe("OpportunityService follow-up completion", () => {
  it("atomically completes current work, creates the future follow-up, and advances the Opportunity", async () => {
    const repository = new MemoryBookingRepository();
    const service = new OpportunityService(
      new BookingService(repository, { now: () => NOW }),
    );

    const result = await service.completeFollowUp({
      opportunityId: OPPORTUNITY_ID,
      followUpId: FOLLOW_UP_ID,
      outcome: "Sent first outreach",
      nextAction: { kind: "email", dueAt: NEXT_DUE_AT },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: FOLLOW_UP_ID,
        completedAt: NOW,
        nextFollowUpId: NEXT_FOLLOW_UP_ID,
      },
    });
    expect(repository.state.followUps.get(NEXT_FOLLOW_UP_ID)).toMatchObject({
      kind: "email",
      dueAt: NEXT_DUE_AT,
      completedAt: null,
    });
    expect(repository.state.opportunity).toEqual({
      id: OPPORTUNITY_ID,
      status: "follow_up",
      nextActionKind: "email",
      nextActionDueAt: NEXT_DUE_AT,
    });
  });

  it("rolls back completion when future follow-up creation fails", async () => {
    const repository = new MemoryBookingRepository();
    repository.failFutureFollowUpCreation = true;
    const service = new OpportunityService(
      new BookingService(repository, { now: () => NOW }),
    );

    await expect(
      service.completeFollowUp({
        opportunityId: OPPORTUNITY_ID,
        followUpId: FOLLOW_UP_ID,
        outcome: "Sent first outreach",
        nextAction: { kind: "email", dueAt: NEXT_DUE_AT },
      }),
    ).rejects.toThrow("future follow-up creation failed");

    expect(repository.state.followUps.get(FOLLOW_UP_ID)).toMatchObject({
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
    });
    expect(repository.state.followUps.has(NEXT_FOLLOW_UP_ID)).toBe(false);
    expect(repository.state.opportunity).toEqual({
      id: OPPORTUNITY_ID,
      status: "contacted",
      nextActionKind: "email",
      nextActionDueAt: NOW,
    });
  });
});
