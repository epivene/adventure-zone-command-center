import {
  approvedContactWrite,
  approvedBookingWrite,
  completeCallInputSchema,
  validateApprovedContactPatch,
  validateApprovedBookingPatch,
} from "@/features/calls/call-input";
import type { BookingStatus } from "@/features/bookings/booking-types";
import {
  dispositionBookingStatus,
  persistedCallDisposition,
  publicCallDisposition,
  type CallContext,
  type CallError,
  type CompletedCall,
  type CompleteCallInput,
} from "@/features/calls/call-types";
import type { CallRepository } from "@/features/calls/call-repository";
import { isFutureBusinessDate } from "@/lib/business-date";
import { err, ok, type Result } from "@/lib/result";

export type {
  CallRepository,
  CallTransaction,
} from "@/features/calls/call-repository";

type CallServiceOptions = {
  now?: () => Date;
  outreachEvents?: { replay(): Promise<void> };
};

function activityAudit(
  input: CompleteCallInput,
  activityId: string,
  organizationId: string | null,
  contactId: string | null,
  bookingId: string | null,
) {
  return {
    entityType: "activity",
    entityId: activityId,
    action: "create",
    before: null,
    after: {
      organizationId,
      contactId,
      bookingId,
      kind: "call",
      body: input.note,
      occurredAt: input.endedAt.toISOString(),
    },
  };
}

function canonicalOrganizationId(context: CallContext) {
  return (
    context.followUp?.organizationId ??
    context.booking?.organizationId ??
    context.contact?.organizationId ??
    context.organization?.id ??
    null
  );
}

function validateCanonicalContext(
  value: CompleteCallInput,
  context: CallContext,
): Result<
  {
    organizationId: string | null;
    contactId: string | null;
    bookingId: string | null;
  },
  CallError
> {
  const followUp = context.followUp;
  const booking = context.booking;
  const contact = context.contact;

  if (
    followUp &&
    value.bookingId !== null &&
    value.bookingId !== followUp.bookingId
  ) {
    return err({ code: "FOLLOW_UP_BOOKING_MISMATCH" });
  }
  if (followUp && value.contactId !== null) {
    if (followUp.contactId !== null && value.contactId !== followUp.contactId) {
      return err({ code: "FOLLOW_UP_CONTACT_MISMATCH" });
    }
    if (followUp.contactId === null) {
      if (followUp.bookingId === null) {
        return err({ code: "FOLLOW_UP_CONTACT_MISMATCH" });
      }
    }
  }
  if (booking && contact && context.contactHasBookingRelationship === false) {
    return err({ code: "CONTACT_BOOKING_MISMATCH" });
  }

  const organizationId =
    value.organizationId ?? canonicalOrganizationId(context);
  if (
    contact &&
    organizationId &&
    context.contactHasActiveOrganizationRelationship === false
  ) {
    return err({ code: "CONTACT_ORGANIZATION_MISMATCH" });
  }
  if (booking?.organizationId && booking.organizationId !== organizationId) {
    return err({ code: "BOOKING_ORGANIZATION_MISMATCH" });
  }
  if (followUp?.organizationId && followUp.organizationId !== organizationId) {
    return err({ code: "FOLLOW_UP_ORGANIZATION_MISMATCH" });
  }
  if (
    context.organization &&
    organizationId &&
    context.organization.id !== organizationId
  ) {
    return err({ code: "ORGANIZATION_NOT_FOUND" });
  }

  return ok({
    organizationId,
    contactId: contact?.id ?? null,
    bookingId: booking?.id ?? null,
  });
}

function defaultCallNote(disposition: CompleteCallInput["disposition"]) {
  return {
    no_answer: "No answer.",
    left_voicemail: "Left voicemail.",
    follow_up_needed: "Follow-up needed.",
    interested: "Interested.",
    proposal_contract_sent: "Proposal or contract sent.",
    booked: "Booked.",
    declined: "Declined.",
    move_to_last_resort: "Moved to Last Resort.",
    spoke_with_contact: "Spoke with contact.",
    wrong_number: "Wrong number.",
    do_not_call: "Marked Do Not Call.",
    email_requested: "Asked us to send information by email.",
  }[disposition];
}

export class CallService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: CallRepository,
    private readonly options: CallServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async complete(
    input: CompleteCallInput,
  ): Promise<Result<CompletedCall, CallError>> {
    const parsed = completeCallInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "INVALID_CALL_INPUT",
        message: parsed.error.issues[0]?.message ?? "Review the call details.",
      });
    }
    const value = {
      ...parsed.data,
      note: parsed.data.note || defaultCallNote(parsed.data.disposition),
    } as CompleteCallInput;
    const completedAt = this.now();

    const result = await this.repository.transaction<
      Result<CompletedCall, CallError>
    >(
      async (transaction) => {
        const replay = await transaction.lockRequest(value.requestKey);
        if (replay) {
          const disposition = publicCallDisposition[replay.disposition];
          return ok({
            activityId: replay.noteActivityId,
            callSessionId: replay.id,
            nextFollowUpId: replay.nextFollowUpId,
            disposition,
            resultingBookingStatus: replay.resultingBookingStatus,
          });
        }
        const context = await transaction.lockContext(value);
        if (value.organizationId && !context.organization) {
          return err({ code: "ORGANIZATION_NOT_FOUND" });
        }
        if (
          value.disposition === "move_to_last_resort" &&
          !context.organization
        ) {
          return err({ code: "LAST_RESORT_REQUIRES_ORGANIZATION" });
        }
        if (value.contactId && !context.contact)
          return err({ code: "CONTACT_NOT_FOUND" });
        if (
          (value.bookingId ||
            value.approvedBookingUpdates ||
            value.resultingBookingStatus) &&
          !context.booking
        ) {
          return err({ code: "BOOKING_NOT_FOUND" });
        }
        if (value.followUpId && !context.followUp)
          return err({ code: "FOLLOW_UP_NOT_FOUND" });
        const canonical = validateCanonicalContext(value, context);
        if (!canonical.ok) return canonical;
        const { organizationId, contactId, bookingId } = canonical.value;
        let selectedPhone = null;
        if (value.phoneId) {
          if (!contactId)
            return err({
              code: "INVALID_CALL_INPUT",
              message: "A selected phone must belong to the linked contact.",
            });
          selectedPhone = await transaction.lockContactPhone(
            value.phoneId,
            contactId,
          );
          if (!selectedPhone)
            return err({
              code: "INVALID_CALL_INPUT",
              message: "Selected phone does not belong to the linked contact.",
            });
        }
        if (
          value.disposition === "do_not_call" &&
          (!value.doNotCallConfirmed ||
            !value.doNotCallReason ||
            !selectedPhone)
        )
          return err({
            code: "INVALID_CALL_INPUT",
            message: "Confirm the selected phone and Do Not Call reason.",
          });
        if (organizationId && !context.organization) {
          return err({ code: "ORGANIZATION_NOT_FOUND" });
        }
        if (
          context.followUp &&
          (context.followUp.completedAt || context.followUp.nextFollowUpId)
        ) {
          return err({ code: "ALREADY_COMPLETED" });
        }

        const mappedStatus = dispositionBookingStatus[value.disposition];
        if (
          mappedStatus &&
          ((value.resultingBookingStatus &&
            value.resultingBookingStatus !== mappedStatus) ||
            (value.approvedBookingUpdates?.status &&
              value.approvedBookingUpdates.status !== mappedStatus))
        )
          return err({ code: "RESULTING_STATUS_MISMATCH" });
        const requestedBookingStatus =
          mappedStatus ??
          value.resultingBookingStatus ??
          value.approvedBookingUpdates?.status;
        const resultingBookingStatus: BookingStatus | null = context.booking
          ? (requestedBookingStatus ?? context.booking.status)
          : null;
        const authoritativeStatus =
          mappedStatus ??
          value.resultingBookingStatus ??
          value.approvedBookingUpdates?.status ??
          null;
        const hasFutureNextAction = Boolean(
          value.nextAction &&
          isFutureBusinessDate(value.nextAction.dueAt, completedAt),
        );
        if (value.nextAction && !hasFutureNextAction) {
          return err({ code: "NEXT_ACTION_REQUIRED" });
        }
        if (value.approvedContactUpdates && !context.contact)
          return err({ code: "CONTACT_NOT_FOUND" });
        const bookingPatch =
          context.booking &&
          (mappedStatus ||
            value.resultingBookingStatus ||
            value.approvedBookingUpdates)
            ? validateApprovedBookingPatch(
                context.booking as Record<string, unknown>,
                value.approvedBookingUpdates ?? {},
                resultingBookingStatus!,
              )
            : null;
        if (bookingPatch && !bookingPatch.success) {
          return err({
            code: "INVALID_CALL_INPUT",
            message:
              bookingPatch.error.issues[0]?.message ??
              "Review the booking updates.",
          });
        }
        const contactPatch =
          context.contact && value.approvedContactUpdates
            ? validateApprovedContactPatch(
                context.contact as Record<string, unknown>,
                context.organization?.name ?? null,
                value.approvedContactUpdates,
              )
            : null;
        if (contactPatch && !contactPatch.success) {
          return err({
            code: "INVALID_CALL_INPUT",
            message:
              contactPatch.error.issues[0]?.message ??
              "Review the contact updates.",
          });
        }

        const activity = await transaction.createActivity({
          organizationId,
          contactId,
          bookingId,
          body: value.note,
          occurredAt: value.endedAt,
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
            organizationId,
            contactId,
            bookingId: context.booking?.id ?? null,
            ...value.nextAction,
          });
          nextFollowUpId = next.id;
          if (context.followUp)
            await transaction.linkNextFollowUp(context.followUp.id, next.id);
          await transaction.createAuditEntry({
            entityType: "follow_up",
            entityId: next.id,
            action: "create",
            before: null,
            after: {
              organizationId,
              contactId,
              bookingId: context.booking?.id ?? null,
              ...value.nextAction,
            },
          });
        }

        const session = await transaction.createCallSession({
          requestKey: value.requestKey,
          organizationId,
          contactId,
          phoneId: value.phoneId,
          direction: value.direction,
          method: value.method,
          phoneNumberSnapshot: selectedPhone?.number ?? null,
          phoneExtensionSnapshot: selectedPhone?.extension ?? null,
          scriptKind: value.scriptKind,
          bookingId,
          followUpId: value.followUpId,
          nextFollowUpId,
          disposition: persistedCallDisposition[value.disposition],
          resultingBookingStatus: requestedBookingStatus ?? null,
          noteActivityId: activity.id,
          startedAt: value.startedAt,
          endedAt: value.endedAt,
        });

        if (
          context.booking &&
          (mappedStatus ||
            value.resultingBookingStatus ||
            value.approvedBookingUpdates)
        ) {
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
            updates: approvedContactWrite(
              contactPatch!.data,
              value.approvedContactUpdates,
            ),
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
        if (value.disposition === "do_not_call")
          await transaction.markPhoneDoNotCall(
            value.phoneId!,
            value.doNotCallReason!,
            completedAt,
          );
        if (value.disposition === "move_to_last_resort") {
          await transaction.setLastResort(
            context.organization!.id,
            value.lastResortReason!,
            completedAt,
          );
          await transaction.createAuditEntry({
            entityType: "organization",
            entityId: context.organization!.id,
            action: "last_resort_enabled",
            before: context.organization as unknown as Record<string, unknown>,
            after: {
              ...context.organization,
              lastResort: true,
              lastResortReason: value.lastResortReason,
            },
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
            after: {
              completedAt: completedAt.toISOString(),
              outcome: value.disposition,
              nextFollowUpId,
            },
          });
        }
        await transaction.createAuditEntry(
          activityAudit(
            value,
            activity.id,
            organizationId,
            contactId,
            bookingId,
          ),
        );
        await transaction.createAuditEntry({
          entityType: "call_session",
          entityId: session.id,
          action: "create",
          before: null,
          after: {
            disposition: value.disposition,
            noteActivityId: activity.id,
          },
        });

        return ok({
          activityId: activity.id,
          callSessionId: session.id,
          nextFollowUpId,
          disposition: value.disposition,
          resultingBookingStatus: requestedBookingStatus ?? null,
        });
      },
      dispositionBookingStatus[value.disposition] ||
        value.resultingBookingStatus ||
        value.approvedBookingUpdates
        ? value.bookingId
        : null,
      dispositionBookingStatus[value.disposition] ||
        value.resultingBookingStatus ||
        value.approvedBookingUpdates
        ? value.followUpId
        : null,
    );
    if (result.ok)
      await this.options.outreachEvents?.replay().catch(() => undefined);
    return result;
  }
}
