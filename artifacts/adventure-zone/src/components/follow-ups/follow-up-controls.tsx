"use client";
import { FollowUpDialog } from "./follow-up-dialog";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";


export type FollowUpControlsItem = {
  id: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
};

export function FollowUpControls({
  followUp,
  onEdit,
  onSkip,
  onDismiss,
  onDelete,
}: {
  followUp: FollowUpControlsItem;
  onEdit: (id: string, input: { kind: string; dueAt: string }) => Promise<{ ok: boolean; error?: string }>;
  onSkip?: (id: string) => void;
  onDismiss?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissError, setDismissError] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (followUp.completedAt) return null;

  async function handleDismiss() {
    setDismissError("");
    setDismissing(true);
    try {
      if (!onDismiss) return;
      const result = await onDismiss(followUp.id);
      if (!result.ok) setDismissError(result.error ?? "Could not dismiss.");
    } catch {
      setDismissError("Could not dismiss. Please try again.");
    } finally {
      setDismissing(false);
    }
  }

  async function handleDelete() {
    setDeleteError("");
    setDeleting(true);
    try {
      const result = await onDelete(followUp.id);
      if (!result.ok) setDeleteError(result.error ?? "Could not delete.");
    } catch {
      setDeleteError("Could not delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-2">
      {!editOpen && !dismissOpen && !deleteOpen ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Follow-up actions" className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800" type="button">
              <MoreHorizontal className="h-4 w-4" /> More
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {onSkip ? <DropdownMenuItem onSelect={() => onSkip(followUp.id)}>Skip for now</DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit follow-up</DropdownMenuItem>
            {onDismiss ? <DropdownMenuItem onSelect={() => setDismissOpen(true)}>Dismiss follow-up</DropdownMenuItem> : null}
            <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onSelect={() => setDeleteOpen(true)}>Delete follow-up</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <FollowUpDialog open={editOpen} onOpenChange={setEditOpen} followUp={followUp} onEdit={onEdit} />

      {dismissOpen ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">Dismiss this follow-up?</p>
          <p className="mt-1 text-sm text-slate-600">It will leave the active queue but stay in history as dismissed.</p>
          {dismissError ? <p className="mt-1 text-xs text-rose-800" role="alert">{dismissError}</p> : null}
          <div className="mt-2 flex gap-2">
            <button className="rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60" disabled={dismissing} onClick={() => void handleDismiss()} type="button">{dismissing ? "Dismissing…" : "Dismiss"}</button>
            <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60" disabled={dismissing} onClick={() => { setDismissOpen(false); setDismissError(""); }} type="button">Cancel</button>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-semibold text-rose-900">Delete this follow-up?</p>
          <p className="mt-1 text-sm text-rose-700">This cannot be undone.</p>
          {deleteError ? <p className="mt-1 text-xs text-rose-800" role="alert">{deleteError}</p> : null}
          <div className="mt-2 flex gap-2">
            <button className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60" disabled={deleting} onClick={() => void handleDelete()} type="button">{deleting ? "Deleting…" : "Yes, delete"}</button>
            <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60" disabled={deleting} onClick={() => { setDeleteOpen(false); setDeleteError(""); }} type="button">Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
