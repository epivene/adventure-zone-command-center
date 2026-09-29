import { useRef, useState } from "react";
import type {
  ProfileTask,
  ProfileTaskCommand,
} from "@/features/assistant-workspace/types";
const button =
  "min-h-[44px] rounded-lg border px-3 py-2 text-sm disabled:opacity-50";
export function ProfileTaskCard({
  task,
  onCommand,
  onReview,
  offline = false,
  readOnly = false,
}: {
  task: ProfileTask;
  onCommand: (
    command: ProfileTaskCommand,
    itemIds?: string[],
    options?: {
      completionMode?: "manual" | "sourced_notes" | "profile_fields";
    },
  ) => Promise<void>;
  onReview: () => Promise<void>;
  offline?: boolean;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const [completionMode, setCompletionMode] = useState<
    "manual" | "sourced_notes" | "profile_fields"
  >(task.scope.completionMode ?? "manual");
  async function act(fn: () => Promise<void>) {
    if (pending.current || offline || readOnly) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError(
        "The task changed or the request could not finish. Refresh progress before trying again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const terminal = ["completed", "cancelled"].includes(task.state),
    unresolved = task.counts.needsReview + task.counts.failed > 0;
  return (
    <section
      aria-label="Profile task"
      className="min-w-0 rounded-xl border border-teal-200 bg-teal-50/40 p-3 text-sm"
    >
      <h3 className="break-words font-semibold">{task.scope.objective}</h3>
      <p className="mt-1">
        {task.state === "completed"
          ? unresolved
            ? "Finished with items needing review"
            : "Finished"
          : task.state.replace("_", " ")}
      </p>
      {offline && (
        <p role="status">
          Last-known progress — reconnect to refresh or change this task.
        </p>
      )}
      <div className="my-3 flex flex-wrap gap-x-4 gap-y-1" aria-live="polite">
        {Object.entries({
          completed: task.counts.completed,
          "need review": task.counts.needsReview,
          failed: task.counts.failed,
          remaining: task.counts.remaining,
        }).map(([label, n]) => (
          <span key={label}>
            {n} {label}
          </span>
        ))}
      </div>
      <p>
        {task.counts.total} profiles · {task.scope.eventYear ?? "No event year"}{" "}
        ·{" "}
        {task.scope.taskCapUsd === null
          ? "Owner spending limits apply"
          : `Task limit $${task.scope.taskCapUsd.toFixed(2)}`}
      </p>
      <p>
        Completion:{" "}
        {task.scope.completionMode === "sourced_notes"
          ? "saved source notes only"
          : task.scope.completionMode === "profile_fields"
            ? "general profile fields only"
            : "owner review of the full objective"}
      </p>
      <p className="text-xs text-slate-600">
        Costs are estimates; unresolved usage remains reserved.
      </p>
      {task.pauseReason && (
        <p className="mt-2">
          Paused: {task.pauseReason.replaceAll("_", " ")}. Resume is explicit;
          allowance resets do not restart this task.
        </p>
      )}
      {task.state === "proposed" && (
        <div className="my-3 rounded-lg bg-white p-3">
          <details className="mb-3">
            <summary>Profiles included ({task.items.length})</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {task.items.map((i) => (
                <li key={i.id}>
                  {i.profileName ?? "Profile awaiting details"}
                </li>
              ))}
            </ul>
          </details>
          <p>Starting confirms this scope and these routine changes:</p>
          <p>
            {task.authority.actionKinds.length
              ? task.authority.actionKinds
                  .map((x) => x.replaceAll("_", " "))
                  .join(", ")
              : "Research only; no automatic profile changes."}
          </p>
          {!!task.authority.allowedFields.length && (
            <p>
              Fill empty fields only: {task.authority.allowedFields.join(", ")}.
            </p>
          )}
          <p>Existing values and other changes require review.</p>
          <label className="mt-2 block">
            Completion requirement
            <select
              aria-label="Task completion requirement"
              className="mt-1 block w-full min-w-0 rounded border p-2"
              value={completionMode}
              disabled={busy || offline || readOnly}
              onChange={(e) =>
                setCompletionMode(e.target.value as typeof completionMode)
              }
            >
              <option value="manual">Review the full objective myself</option>
              <option value="sourced_notes">Save source notes only</option>
              {task.scope.eventYear === null &&
                task.scope.requestedFields.length > 0 && (
                  <option value="profile_fields">
                    Fill general profile fields only
                  </option>
                )}
            </select>
          </label>
          <p className="mt-2">
            Source-note completion means source text was saved; it does not
            verify an organizer or resolve every claim. General fields do not
            verify an event-specific role.
          </p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!terminal && (
          <button
            className={button}
            disabled={busy || offline || readOnly}
            onClick={() =>
              void act(() =>
                onCommand(
                  task.state === "running" ? "pause" : "resume",
                  undefined,
                  task.state === "proposed" ? { completionMode } : undefined,
                ),
              )
            }
          >
            {task.state === "proposed"
              ? "Confirm scope and start"
              : task.state === "running"
                ? "Pause"
                : "Resume"}
          </button>
        )}
        {!terminal && (
          <button
            className={button}
            disabled={busy || offline || readOnly}
            onClick={() => void act(() => onCommand("cancel"))}
          >
            Cancel
          </button>
        )}
        {!!task.changes?.length && (
          <button
            className={button}
            disabled={busy || offline || readOnly}
            onClick={() => void act(onReview)}
          >
            Review changes ({task.changes.length})
          </button>
        )}
      </div>
      {!!task.items.filter((i) =>
        ["needs_review", "failed", "uncertain"].includes(i.state),
      ).length && (
        <details className="mt-3">
          <summary>Unresolved profiles</summary>
          <ul className="mt-2 space-y-2">
            {task.items
              .filter((i) =>
                ["needs_review", "failed", "uncertain"].includes(i.state),
              )
              .map((i) => (
                <li key={i.id} className="break-words">
                  <strong>{i.profileName ?? "Profile awaiting details"}</strong>
                  :{" "}
                  {i.reason?.replaceAll("_", " ") ??
                    i.state.replaceAll("_", " ")}{" "}
                  {task.state !== "cancelled" && i.state !== "uncertain" && (
                    <button
                      className={button}
                      disabled={busy || offline || readOnly}
                      onClick={() => void act(() => onCommand("retry", [i.id]))}
                    >
                      Retry {i.profileName ?? "profile"}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
