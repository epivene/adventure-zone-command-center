import {
  type Booking,
  type BookingRepository,
  type BookingTransaction,
  type FollowUp,
} from "@/features/bookings/booking-repository";
import type { BookingStatus, Probability } from "@/features/bookings/booking-types";
import { needsFollowUpPlan } from "@/features/follow-ups/follow-up-policy";
import { err, ok, type Result } from "@/lib/result";

export type { Booking, BookingRepository, BookingTransaction, FollowUp };

export type DomainError =
  | { code: "FOLLOW_UP_NOT_FOUND" }
  | { code: "NEXT_ACTION_REQUIRED" };

export type CompleteFollowUpInput = {
  followUpId: string;
  outcome: string;
  status?: BookingStatus;
  nextAction: { kind: string; dueAt: Date } | null;
};

export type CreateBookingInput = {
  name: string;
  city: string;
  region: string;
  status?: BookingStatus;
  probability?: Probability;
};

type BookingServiceOptions = {
  now?: () => Date;
};

export class BookingService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: BookingRepository,
    options: BookingServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    return this.repository.createBooking({
      ...input,
      status: input.status ?? "new_lead",
      probability: input.probability ?? "possible",
    });
  }

  async completeFollowUp(
    input: CompleteFollowUpInput,
  ): Promise<Result<FollowUp, DomainError>> {
    const context = await this.repository.findFollowUpWithBooking(input.followUpId);
    if (!context) return err({ code: "FOLLOW_UP_NOT_FOUND" });

    const resultingStatus = input.status ?? context.booking.status;
    if (
      needsFollowUpPlan(
        { status: resultingStatus },
        input.nextAction ? { ...input.nextAction, completedAt: null } : null,
      )
    ) {
      return err({ code: "NEXT_ACTION_REQUIRED" });
    }

    const followUp = await this.repository.transaction(async (transaction) => {
      const completedAt = this.now();
      const completed = await transaction.completeFollowUp(input.followUpId, {
        outcome: input.outcome,
        completedAt,
      });

      let nextFollowUpId: string | null = null;
      if (input.nextAction) {
        const nextFollowUp = await transaction.createFollowUp({
          bookingId: context.booking.id,
          ...input.nextAction,
        });
        nextFollowUpId = nextFollowUp.id;
        await transaction.linkNextFollowUp(completed.id, nextFollowUpId);
      }

      if (input.status) {
        await transaction.updateBookingStatus({
          bookingId: context.booking.id,
          status: input.status,
        });
      }

      await transaction.createAuditEntry({
        entityType: "follow_up",
        entityId: completed.id,
        action: "completed",
        before: {
          completedAt: context.followUp.completedAt?.toISOString() ?? null,
          outcome: context.followUp.outcome,
          nextFollowUpId: context.followUp.nextFollowUpId,
        },
        after: {
          completedAt: completedAt.toISOString(),
          outcome: input.outcome,
          nextFollowUpId,
        },
      });

      return { ...completed, nextFollowUpId };
    });

    return ok(followUp);
  }
}
