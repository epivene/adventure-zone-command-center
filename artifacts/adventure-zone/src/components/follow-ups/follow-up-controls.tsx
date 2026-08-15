import { useState, type FormEvent } from "react";

import {
  deleteFollowUpAction,
  editFollowUpAction,
} from "@/actions/follow-ups";
import type { FollowUpRecord } from "@/features/follow-ups/follow-up-types";

const followUpKinds = [
  ["call", "Call"],
  ["send_information", "Send information"],
  ["prepare_quote", "Prepare quote"],
  ["check_contract", "Check on contract"],
] as const;

const deleteConfirmation =
  "Delete this follow-up permanently? Calls, contacts, profiles, bookings, and other follow-ups will remain.";

function businessDateValue(date: Date) {
  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

export function FollowUpControls({
  followUp,
  onChanged,
  onDeleted,
}: {
  followUp: FollowUpRecord;
  onChanged: (updated: FollowUpRecord) => void;
  onDeleted: (followUpId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const [dueAt, setDueAt] = useState(() => businessDateValue(followUp.dueAt));
  const [kind, setKind] = useState(followUp.kind);
  const [completed, setCompleted] = useState(Boolean(followUp.completedAt));
  const [outcome, setOutcome] = useState(followUp.outcome ?? "");
  const isBusy = isSaving || isDeleting;

  function openEditor() {
    setDueAt(businessDateValue(followUp.dueAt));
    setKind(followUp.kind);
    setCompleted(Boolean(followUp.completedAt));
    setOutcome(followUp.outcome ?? "");
    setError("");
    setIsEditing(true);
  }

  async function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedOutcome = outcome.trim();
    if (!dueAt) {
      setError("Choose a valid due date.");
      return;
    }
    if (completed && !trimmedOutcome) {
      setError("Outcome is required for a completed follow-up.");
      return;
    }

    setError("");
    setIsSaving(true);
    try {
      const result = await editFollowUpAction({
        followUpId: followUp.id,
        kind,
        dueAt,
        completed,
        outcome: completed ? trimmedOutcome : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged(result.followUp);
      setIsEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not update follow-up.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteFollowUp() {
    if (!window.confirm(deleteConfirmation)) return;

    setError("");
    setIsDeleting(true);
    try {
      const result = await deleteFollowUpAction(followUp.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted(followUp.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete follow-up.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3">
      {error ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {isEditing ? (
        <form className="grid gap-3" onSubmit={saveFollowUp}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Due date
              <input
                disabled={isBusy}
                onChange={(event) => setDueAt(event.target.value)}
                required
                type="date"
                value={dueAt}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Follow-up type
              <select
                disabled={isBusy}
                onChange={(event) => setKind(event.target.value)}
                value={kind}
              >
                {followUpKinds.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              checked={completed}
              disabled={isBusy}
              onChange={(event) => setCompleted(event.target.checked)}
              type="checkbox"
            />
            Completed
          </label>

          {completed ? (
            <label className="grid gap-1.5 text-sm font-medium">
              Outcome
              <input
                disabled={isBusy}
                onChange={(event) => setOutcome(event.target.value)}
                required
                type="text"
                value={outcome}
              />
            </label>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              className="button-secondary"
              disabled={isBusy}
              onClick={() => {
                setError("");
                setIsEditing(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button-primary" disabled={isBusy} type="submit">
              {isSaving ? "Saving…" : "Save follow-up"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            className="button-secondary"
            disabled={isBusy}
            onClick={openEditor}
            type="button"
          >
            Edit follow-up
          </button>
          <button
            className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={() => void deleteFollowUp()}
            type="button"
          >
            {isDeleting ? "Deleting…" : "Delete follow-up"}
          </button>
        </div>
      )}
    </div>
  );
}
