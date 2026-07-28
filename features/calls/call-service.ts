import {
  approvedBookingWrite,
  completeCallInputSchema,
  validateApprovedBookingPatch,
} from "@/features/calls/call-input";
import type { BookingStatus } from "@/features/bookings/booking-types";
import { needsFollowUpPlan } from "@/features/follow-ups/follow-up-policy";
import {
  dispositionBookingStatus,
  persistedCallDisposition,
  type CallError,
  type CompletedCall,
  type CompleteCallInput,
} from "@/features/calls/call-types";
import type { CallRepository } from "@/features/calls/call-repository";
import { err, ok, type Result } from "@/lib/result";

export type { CallRepository, CallTransaction } from "@/features/calls/call-repository";

type CallServiceOptions = { now?: () => Date };

function activityAudit(
  input: CompleteCallInput,
  activityId: string,
  contactId: string | null,
  bookingId: string | null,
) {
  return {
    entityType: "activity",
    entityId: activityId,
    action: "create",
    before: null,
    after: {
      organizationId: input.organizationId,
      contactId,
      bookingId,
      kind: "call",
      body: input.note,
      occurredAt: input.endedAt.toISOString(),
    },
  };
}

export class CallService {
  private readonly now: () => Date;

  constructor(private readonly repository: CallRepository, options: CallServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async complete(input: CompleteCallInput): Promise<Result<CompletedCall, CallError>> {
    const parsed = completeCallInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_CALL_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the call details.",
      });
    }
    const value = parsed.data as CompleteCallInput;
    const completedAt = this.now();

    return this.repository.transaction(async (transaction) => {
      const context = await transaction.lockContext(value);
      if (value.organizationId && !context.organization) {
        return err({ code: "ORGANIZATION_NOT_FOUND" });
      }
      if (value.disposition === "move_to_last_resort" && !context.organization) {
        return err({ code: "LAST_RESORT_REQUIRES_ORGANIZATION" });
      }
      if (value.contactId && !context.contact) return err({ code: "CONTACT_NOT_FOUND" });
      if ((value.bookingId || value.approvedBookingUpdates || value.resultingBookingStatus) && !context.booking) {
        return err({ code: "BOOKING_NOT_FOUND" });
      }
      if (value.followUpId && !context.followUp) return err({ code: "FOLLOW_UP_NOT_FOUND" });
      if (context.followUp?.bookingId && value.bookingId && context.followUp.bookingId !== value.bookingId) {
        return err({ code: "FOLLOW_UP_BOOKING_MISMATCH" });
      }
      if (context.contact && context.contact.organizationId !== value.organizationId) {
        return err({ code: "CONTACT_ORGANIZATION_MISMATCH" });
      }
      if (context.booking && context.booking.organizationId !== value.organizationId) {
        return err({ code: "BOOKING_ORGANIZATION_MISMATCH" });
      }
      if (context.followUp?.organizationId && context.followUp.organizationId !== value.organizationId) {
        return err({ code: "FOLLOW_UP_ORGANIZATION_MISMATCH" });
      }
      if (context.followUp?.contactId && value.contactId && context.followUp.contactId !== value.contactId) {
        return err({ code: "FOLLOW_UP_CONTACT_MISMATCH" });
      }
      if (context.followUp && (context.followUp.completedAt || context.followUp.nextFollowUpId)) {
        return err({ code: "ALREADY_COMPLETED" });
      }

      const mappedStatus = dispositionBookingStatus[value.disposition];
      if (
        mappedStatus && (
          (value.resultingBookingStatus && value.resultingBookingStatus !== mappedStatus) ||
          (value.approvedBookingUpdates?.status && value.approvedBookingUpdates.status !== mappedStatus)
        )
      ) return err({ code: "RESULTING_STATUS_MISMATCH" });
      const requestedBookingStatus = mappedStatus
        ?? value.resultingBookingStatus
        ?? value.approvedBookingUpdates?.status;
      const resultingBookingStatus: BookingStatus | null = context.booking
        ? requestedBookingStatus ?? context.booking.status
        : null;
      const authoritativeStatus = mappedStatus
        ?? value.resultingBookingStatus
        ?? value.approvedBookingUpdates?.status
        ?? null;
      const bookingStatus = context.booking
        ? resultingBookingStatus ?? context.booking.status
        : null;
      if (context.booking && needsFollowUpPlan(
        { status: bookingStatus! },
        value.nextAction ? { ...value.nextAction, completedAt: null } : null,
        completedAt,
      )) {
        return err({ code: "NEXT_ACTION_REQUIRED" });
      }
      if (value.approvedContactUpdates && !context.contact) return err({ code: "CONTACT_NOT_FOUND" });
      const contactId = context.contact?.id ?? value.contactId;
      const bookingId = context.booking?.id ?? value.bookingId;
      const bookingPatch = context.booking && (
        mappedStatus || value.resultingBookingStatus || value.approvedBookingUpdates
      )
        ? validateApprovedBookingPatch(
          context.booking as Record<string, unknown>,
          value.approvedBookingUpdates ?? {},
          resultingBookingStatus!,
        )
        : null;
      if (bookingPatch && !bookingPatch.success) {
        return err({
          code: "INVALID_CALL_INPUT",
          message: bookingPatch.error.issues[0]?.message ?? "Review the booking updates.",
        });
      }

      const activity = await transaction.createActivity({
        organizationId: value.organizationId,
        contactId,
        bookingId,
        body: value.note,
        occurredAt: value.endedAt,
      });
      const session = await transaction.createCallSession({
        organizationId: value.organizationId,
        contactId,
        bookingId,
        followUpId: value.followUpId,
        disposition: persistedCallDisposition[value.disposition],
        noteActivityId: activity.id,
        startedAt: value.startedAt,
        endedAt: value.endedAt,
      });

      let nextFollowUpId: string | null = null;
      if (context.followUp) {
        await transaction.completeFollowUp(context.followUp.id, {
          outcome: value.disposition,
          completedAt,
        });
      }
      if (value.nextAction) {
        const next = await transaction.createFollowUp({
          organizationId: value.organizationId,
          contactId,
          bookingId: context.booking?.id ?? null,
          ...value.nextAction,
        });
        nextFollowUpId = next.id;
        if (context.followUp) await transaction.linkNextFollowUp(context.followUp.id, next.id);
        await transaction.createAuditEntry({
          entityType: "follow_up",
          entityId: next.id,
          action: "create",
          before: null,
          after: {
            organizationId: value.organizationId,
            contactId,
            bookingId: context.booking?.id ?? null,
            ...value.nextAction,
          },
        });
      }

      if (context.booking && (
        mappedStatus || value.resultingBookingStatus || value.approvedBookingUpdates
      )) {
        const updated = await transaction.updateBooking(
          context.booking.id,
          approvedBookingWrite(
            bookingPatch!.data,
            value.approvedBookingUpdates ?? {},
            authoritativeStatus,
          ),
        );
        await transaction.createAuditEntry({
          entityType: "booking",
          entityId: context.booking.id,
          action: "update",
          before: context.booking as Record<string, unknown>,
          after: updated as Record<string, unknown>,
        });
      }
      if (value.approvedContactUpdates && context.contact) {
        const updated = await transaction.updateContact({
          contact: context.contact,
          organizationName: context.organization?.name ?? null,
          updates: value.approvedContactUpdates,
          now: completedAt,
        });
        await transaction.createAuditEntry({
          entityType: "contact",
          entityId: context.contact.id,
          action: "update",
          before: context.contact as Record<string, unknown>,
          after: updated,
        });
      }
      if (value.disposition === "move_to_last_resort") {
        await transaction.setLastResort(context.organization!.id, value.lastResortReason!, completedAt);
        await transaction.createAuditEntry({
          entityType: "organization",
          entityId: context.organization!.id,
          action: "last_resort_enabled",
          before: context.organization as unknown as Record<string, unknown>,
          after: { ...context.organization, lastResort: true, lastResortReason: value.lastResortReason },
        });
      }
      if (context.followUp) {
        await transaction.createAuditEntry({
          entityType: "follow_up",
          entityId: context.followUp.id,
          action: "completed",
          before: {
            completedAt: context.followUp.completedAt,
            outcome: context.followUp.outcome,
            nextFollowUpId: context.followUp.nextFollowUpId,
          },
          after: { completedAt: completedAt.toISOString(), outcome: value.disposition, nextFollowUpId },
        });
      }
      await transaction.createAuditEntry(
        activityAudit(value, activity.id, contactId, bookingId),
      );
      await transaction.createAuditEntry({
        entityType: "call_session",
        entityId: session.id,
        action: "create",
        before: null,
        after: { disposition: value.disposition, noteActivityId: activity.id },
      });

      return ok({
        activityId: activity.id,
        callSessionId: session.id,
        nextFollowUpId,
        disposition: value.disposition,
        resultingBookingStatus: requestedBookingStatus ?? null,
      });
    });
  }
}
