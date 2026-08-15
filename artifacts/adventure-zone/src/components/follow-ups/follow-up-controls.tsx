"use client";

import { useState } from "react";

const FOLLOW_UP_KINDS = [
  { value: "call", label: "Call" },
  { value: "send_information", label: "Send information" },
  { value: "prepare_quote", label: "Prepare quote" },
  { value: "check_contract", label: "Check on contract" },
] as const;

function toDateInputValue(date: Date): string {
  // Format as YYYY-MM-DD in local time (the dueAt stored is already a date)
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type FollowUpControlsItem = {
  id: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
};

export function FollowUpControls({
  followUp,
  onEdit,
  onDelete,
}: {
  followUp: FollowUpControlsItem;
  onEdit: (
    id: string,
    input: { kind: string; dueAt: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editKind, setEditKind] = useState(followUp.kind);
  const [editDueAt, setEditDueAt] = useState(() => toDateInputValue(followUp.dueAt));
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Don't show controls for completed follow-ups
  if (followUp.completedAt) return null;

  async function handleEdit() {
    if (!editDueAt) {
      setEditError("Choose a date.");
      return;
    }
    setEditError("");
    setEditSaving(true);
    try {
      const result = await onEdit(followUp.id, { kind: editKind, dueAt: editDueAt });
      if (!result.ok) {
        setEditError(result.error ?? "Could not update.");
      } else {
        setEditOpen(false);
      }
    } catch {
      setEditError("Could not update. Please try again.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteError("");
    setDeleting(true);
    try {
      const result = await onDelete(followUp.id);
      if (!result.ok) {
        setDeleteError(result.error ?? "Could not delete.");
      }
      // On success: parent removes the item from its list
    } catch {
      setDeleteError("Could not delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-2">
      {!editOpen && !deleteOpen && (
        <div className="flex gap-3">
          <button
            className="text-xs font-medium text-orange-700 underline-offset-2 hover:underline"
            onClick={() => setEditOpen(true)}
            type="button"
          >
            Edit follow-up
          </button>
          <button
            className="text-xs font-medium text-rose-700 underline-offset-2 hover:underline"
            onClick={() => setDeleteOpen(true)}
            type="button"
          >
            Delete follow-up
          </button>
        </div>
      )}

      {editOpen && (
        <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <p className="text-sm font-semibold text-orange-900">Edit follow-up</p>
          <div className="mt-2 grid gap-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-700">Type</span>
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                onChange={(e) => setEditKind(e.target.value)}
                value={editKind}
              >
                {FOLLOW_UP_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
                {/* Keep any custom kind that isn't in the standard list */}
                {!FOLLOW_UP_KINDS.some((k) => k.value === followUp.kind) && (
                  <option value={followUp.kind}>{followUp.kind.replaceAll("_", " ")}</option>
                )}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-700">Due date</span>
              <input
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                onChange={(e) => setEditDueAt(e.target.value)}
                type="date"
                value={editDueAt}
              />
            </label>
            {editError ? (
              <p className="text-xs text-rose-700" role="alert">
                {editError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                className="rounded bg-orange-700 px-2 py-1 text-xs font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
                disabled={editSaving}
                onClick={() => void handleEdit()}
                type="button"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
              <button
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={editSaving}
                onClick={() => {
                  setEditOpen(false);
                  setEditError("");
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-semibold text-rose-900">Delete this follow-up?</p>
          <p className="mt-1 text-sm text-rose-700">This cannot be undone.</p>
          {deleteError ? (
            <p className="mt-1 text-xs text-rose-800" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              disabled={deleting}
              onClick={() => void handleDelete()}
              type="button"
            >
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={deleting}
              onClick={() => {
                setDeleteOpen(false);
                setDeleteError("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
