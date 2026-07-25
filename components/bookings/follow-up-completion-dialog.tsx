"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  bookingStatusValues,
  type BookingStatus,
} from "@/features/bookings/booking-types";
import type {
  CompleteFollowUpInput,
  DomainError,
  FollowUp,
} from "@/features/bookings/booking-service";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
import type { FollowUpCompletionActionError } from "@/features/bookings/follow-up-completion-input";
import type { Result } from "@/lib/result";

type CompletionHandler = (
  input: CompleteFollowUpInput,
) => Promise<Result<FollowUp, DomainError | FollowUpCompletionActionError>>;

export function FollowUpCompletionDialog({
  bookingStatus,
  followUpId,
  onComplete,
}: {
  bookingStatus: BookingStatus;
  followUpId: string;
  onComplete: CompletionHandler;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultingStatus, setResultingStatus] = useState<BookingStatus>(bookingStatus);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const outcomeRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (isOpen) outcomeRef.current?.focus();
  }, [isOpen]);

  function closeDialog() {
    setError("");
    setIsOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const outcome = String(formData.get("outcome") ?? "");
    const nextActionKind = String(formData.get("nextActionKind") ?? "");
    const nextActionDueAt = String(formData.get("nextActionDueAt") ?? "");

    if (!outcome) {
      setError("Choose a call outcome.");
      return;
    }
    if (
      isActiveStatus(resultingStatus) &&
      (!nextActionKind || !nextActionDueAt)
    ) {
      setError("Choose a next action and date before completing this call.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      const result = await onComplete({
        followUpId,
        outcome,
        status: resultingStatus,
        nextAction:
          nextActionKind && nextActionDueAt
            ? {
                kind: nextActionKind,
                dueAt: new Date(`${nextActionDueAt}T12:00:00`),
              }
            : null,
      });

      if (!result.ok) {
        setError(
          result.error.code === "NEXT_ACTION_REQUIRED"
            ? "Choose a next action and date before completing this call."
            : result.error.code === "INVALID_COMPLETION_INPUT"
              ? "Choose an outcome and a valid next action."
              : "This follow-up could not be found. Refresh and try again.",
        );
        return;
      }

      closeDialog();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        className="button-primary"
        onClick={() => setIsOpen(true)}
        ref={triggerRef}
        type="button"
      >
        Complete call
      </button>

      {isOpen ? (
        <div
          aria-labelledby="complete-call-title"
          aria-modal="true"
          className="fixed inset-0 z-30 grid place-items-center bg-slate-950/50 p-4"
          onKeyDown={handleDialogKeyDown}
          role="dialog"
        >
          <form
            className="grid max-h-[90vh] w-full max-w-lg gap-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onSubmit={handleSubmit}
            ref={dialogRef}
          >
            <div>
              <h2 className="text-xl font-bold" id="complete-call-title">
                Complete call
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Record the result and make the next step explicit.
              </p>
            </div>

            {error ? (
              <p
                className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <label className="grid gap-1.5 font-medium">
              Call outcome
              <select defaultValue="" name="outcome" ref={outcomeRef}>
                <option value="">Choose an outcome</option>
                <option value="call_again">Call again</option>
                <option value="send_information">Send information</option>
                <option value="prepare_quote">Prepare quote</option>
                <option value="wait_for_board">Wait for board meeting</option>
                <option value="check_contract">Check on contract</option>
                <option value="confirmed">Mark confirmed</option>
                <option value="declined">Mark unlikely or declined</option>
                <option value="closed">Close with no further action</option>
              </select>
            </label>

            <label className="grid gap-1.5 font-medium">
              Resulting status
              <select
                name="status"
                onChange={(event) =>
                  setResultingStatus(event.target.value as BookingStatus)
                }
                value={resultingStatus}
              >
                {bookingStatusValues.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            {isActiveStatus(resultingStatus) ? (
              <>
                <label className="grid gap-1.5 font-medium">
                  Next action type
                  <select defaultValue="" name="nextActionKind">
                    <option value="">Choose an action</option>
                    <option value="call">Call</option>
                    <option value="send_information">Send information</option>
                    <option value="prepare_quote">Prepare quote</option>
                    <option value="check_contract">Check on contract</option>
                  </select>
                </label>
                <label className="grid gap-1.5 font-medium">
                  Next action date
                  <input name="nextActionDueAt" type="date" />
                </label>
              </>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="button-secondary"
                onClick={closeDialog}
                type="button"
              >
                Cancel
              </button>
              <button className="button-primary" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Saving…" : "Save call outcome"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
