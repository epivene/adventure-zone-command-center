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
  | { code: "ALREADY_COMPLETED" }
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
  nextAction?: { kind: string; dueAt: Date } | null;
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
    const status = input.status ?? "new_lead";
    const now = this.now();
    if (
      needsFollowUpPlan(
        { status },
        input.nextAction ? { ...input.nextAction, completedAt: null } : null,
        now,
      )
    ) {
      throw new Error("NEXT_ACTION_REQUIRED");
    }

    return this.repository.transaction(async (transaction) => {
      const booking = await transaction.createBooking({
        name: input.name,
        city: input.city,
        region: input.region,
        status,
        probability: input.probability ?? "possible",
      });

      if (input.nextAction) {
        await transaction.createFollowUp({
          bookingId: booking.id,
          ...input.nextAction,
        });
      }

      return booking;
    });
  }

  async completeFollowUp(
    input: CompleteFollowUpInput,
  ): Promise<Result<FollowUp, DomainError>> {
    const now = this.now();
    return this.repository.transaction(async (transaction) => {
      const context = await transaction.findFollowUpWithBookingForUpdate(
        input.followUpId,
      );
      if (!context) return err({ code: "FOLLOW_UP_NOT_FOUND" });
      if (
        context.followUp.completedAt !== null ||
        context.followUp.nextFollowUpId !== null
      ) {
        return err({ code: "ALREADY_COMPLETED" });
      }

      const resultingStatus = input.status ?? context.booking.status;
      if (
        needsFollowUpPlan(
          { status: resultingStatus },
          input.nextAction ? { ...input.nextAction, completedAt: null } : null,
          now,
        )
      ) {
        return err({ code: "NEXT_ACTION_REQUIRED" });
      }

      const completedAt = now;
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
        const updatedBooking = await transaction.updateBookingStatus({
          bookingId: context.booking.id,
          status: input.status,
        });
        if (updatedBooking.status !== context.booking.status) {
          await transaction.createAuditEntry({
            entityType: "booking",
            entityId: context.booking.id,
            action: "update",
            before: { status: context.booking.status },
            after: { status: updatedBooking.status },
          });
        }
      }

      await transaction.createAuditEntry({
        entityType: "follow_up",
        entityId: completed.id,
        action: "completed",
        before: {
          completedAt: null,
          outcome: context.followUp.outcome,
          nextFollowUpId: context.followUp.nextFollowUpId,
        },
        after: {
          completedAt: completedAt.toISOString(),
          outcome: input.outcome,
          nextFollowUpId,
        },
      });

      return ok({ ...completed, nextFollowUpId });
    }, input.status ? input.followUpId : undefined);
  }
}
