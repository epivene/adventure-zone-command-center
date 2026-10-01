import { useState } from "react";
import {
  labels,
  statuses,
  workRequest,
  WorkRequestError,
  reviewLink,
  ownerLabel,
  type Actor,
  type WorkActivity,
} from "./client";
export function WorkActivityCard({
  activity: a,
  actors = [],
  onChanged,
  onEditingChange,
}: {
  activity: WorkActivity;
  actors?: Actor[];
  onChanged: () => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [next, setNext] = useState(a.nextAction),
    [status, setStatus] = useState(a.status),
    [due, setDue] = useState(a.dueAt?.slice(0, 10) ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [assigned, setAssigned] = useState("");
  const [editBase, setEditBase] = useState(a);
  const [conflict, setConflict] = useState<WorkActivity | null>(null);
  const latest = conflict && conflict.revision > a.revision ? conflict : a;
  const needsReview = editing && latest.revision !== editBase.revision;
  const closed = ["completed", "cancelled"].includes(a.status);
  async function save(reassign = false) {
    setBusy(true);
    setError("");
    try {
      if (reassign) {
        const target = actors.find((x) => `${x.kind}:${x.id}` === assigned);
        await workRequest(`/${a.id}/reassign`, "POST", {
          revision: editBase.revision,
          actor: target ? { kind: target.kind, id: target.id } : null,
        });
      } else
        await workRequest(`/${a.id}`, "PATCH", {
          revision: editBase.revision,
          patch: {
            ...(next !== editBase.nextAction ? { nextAction: next } : {}),
            ...(status !== editBase.status ? { status } : {}),
            ...(due === (editBase.dueAt?.slice(0, 10) ?? "")
              ? {}
              : { dueAt: due ? `${due}T18:00:00Z` : null }),
          },
        });
      setEditing(false);
      onEditingChange?.(false);
      onChanged();
    } catch (e) {
      if (e instanceof WorkRequestError && e.current) setConflict(e.current);
      setError(
        e instanceof WorkRequestError && e.status === 409
          ? "This work changed. Your edits are kept here. Review the latest version below before saving again."
          : e instanceof Error
            ? e.message
            : "Could not save.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-4 text-foreground">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{a.title}</h3>
          <p className="text-sm text-muted-foreground">
            {a.eventYear} · {labels[a.queue]}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
          {labels[a.status]}
        </span>
      </div>
      <p className="mt-2 text-sm">
        Assigned to {ownerLabel(a.assignedTo, actors)}
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words">{a.nextAction}</p>
      {a.progress ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">
            {a.progress.completed} of {a.progress.total} completed
          </p>
          {a.progress.total > 0 ? (
            <progress
              className="w-full"
              max={a.progress.total}
              value={a.progress.completed}
            />
          ) : null}
          <p className="text-sm">{a.progress.summary}</p>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Last updated {new Date(a.updatedAt).toLocaleString()}
        {a.dueAt ? ` · Due ${new Date(a.dueAt).toLocaleDateString()}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <a className="text-sm underline" href={`/profiles/${a.profileId}`}>
          Open profile
        </a>
        {a.links.map((l, i) => {
          const href = reviewLink(l, a.profileId);
          return href ? (
            <a
              className="max-w-full break-words text-sm underline"
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </a>
          ) : null;
        })}
      </div>
      {!closed && !editing ? (
        <button
          className="button-secondary mt-3"
          onClick={() => {
            setNext(a.nextAction);
            setStatus(a.status);
            setDue(a.dueAt?.slice(0, 10) ?? "");
            setEditBase(a);
            setConflict(null);
            setError("");
            setEditing(true);
            onEditingChange?.(true);
          }}
        >
          Edit work
        </button>
      ) : null}
      {editing ? (
        <div className="mt-4 grid gap-3">
          {needsReview ? (
            <div className="rounded border p-3 text-sm">
              <p className="font-semibold">
                Latest version ({latest.revision})
              </p>
              <p>Next action: {latest.nextAction}</p>
              <p>Status: {labels[latest.status]}</p>
              <p>
                Due:{" "}
                {latest.dueAt
                  ? new Date(latest.dueAt).toLocaleString()
                  : "None"}
              </p>
              <button
                className="button-secondary mt-2"
                disabled={
                  busy || ["completed", "cancelled"].includes(latest.status)
                }
                onClick={() => {
                  if (next === editBase.nextAction) setNext(latest.nextAction);
                  if (status === editBase.status) setStatus(latest.status);
                  if (due === (editBase.dueAt?.slice(0, 10) ?? ""))
                    setDue(latest.dueAt?.slice(0, 10) ?? "");
                  setEditBase(latest);
                  setError("");
                }}
              >
                Use latest version and keep my changes
              </button>
              {["completed", "cancelled"].includes(latest.status) ? (
                <p>
                  This activity is closed. Copy any wording you need before
                  cancelling your edit.
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="grid gap-1 text-sm">
            Next action
            <textarea
              className="min-h-24 w-full rounded border bg-background p-2"
              value={next}
              maxLength={2000}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Work status
            <select
              className="rounded border bg-background p-2"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as WorkActivity["status"])
              }
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Due date
            <input
              className="rounded border bg-background p-2"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="button-primary"
              disabled={
                busy ||
                needsReview ||
                !next.trim() ||
                (next === editBase.nextAction &&
                  status === editBase.status &&
                  due === (editBase.dueAt?.slice(0, 10) ?? ""))
              }
              onClick={() => void save()}
            >
              Save changes
            </button>
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                onEditingChange?.(false);
                setError("");
              }}
            >
              Cancel editing
            </button>
          </div>
          <label className="grid gap-1 text-sm">
            Hand off to
            <select
              className="rounded border bg-background p-2"
              value={assigned}
              onChange={(e) => setAssigned(e.target.value)}
            >
              <option value="">Unassigned</option>
              {actors.map((x) => (
                <option key={`${x.kind}:${x.id}`} value={`${x.kind}:${x.id}`}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button-secondary justify-self-start"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Change assignment
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
