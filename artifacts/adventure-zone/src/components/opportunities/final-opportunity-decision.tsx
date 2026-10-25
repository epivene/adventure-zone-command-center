import { useState, type FormEvent } from "react";
import { apiPost } from "@/lib/auth-token";
import {
  mountainInput,
  mountainInstant,
} from "@/features/today/follow-up-time";
const field =
  "rounded-md border border-border bg-background p-2 text-foreground";
export function FinalOpportunityDecision({
  id,
  revision,
  status,
  year,
  onSaved,
  onCancel,
}: {
  id: string;
  revision: string;
  status: string;
  year: number;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [decision, setDecision] = useState(""),
    [action, setAction] = useState(""),
    [due, setDue] = useState(
      mountainInput(new Date(Date.now() + 7 * 86400000).toISOString()),
    );
  const [reason, setReason] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      await apiPost("/work-queue/decide", {
        id,
        source: "opportunity",
        expectedRevision: revision,
        finalStatus: status,
        outcome: `Marked ${year} opportunity ${status.replaceAll("_", " ")}`,
        nextAction:
          decision === "schedule"
            ? { kind: action, dueAt: mountainInstant(due) }
            : null,
        ...(decision === "none" ? { noFurtherActionReason: reason } : {}),
      });
      saved = true;
      await onSaved();
    } catch (cause) {
      setError(
        saved
          ? "Status saved. Reload to see the current opportunity."
          : cause instanceof Error
            ? cause.message
            : "Could not save the final decision.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-3 rounded-xl border-2 border-primary p-4"
      onSubmit={(e) => void save(e)}
    >
      <h3 className="font-bold">
        {year}: mark {status.replaceAll("_", " ")}
      </h3>
      <label className="grid gap-1">
        Final decision
        <select
          className={field}
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        >
          <option value="">Choose a next step</option>
          <option value="schedule">Schedule a follow-up</option>
          <option value="none">No further action</option>
        </select>
      </label>
      {decision === "schedule" ? (
        <>
          <label className="grid gap-1">
            Next action
            <input
              className={field}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            Due date and time (Mountain)
            <input
              className={field}
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
        </>
      ) : decision === "none" ? (
        <label className="grid gap-1">
          No further action reason
          <textarea
            className={field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <button
          className={field}
          type="submit"
          disabled={
            busy ||
            !decision ||
            (decision === "none" ? !reason.trim() : !action.trim() || !due)
          }
        >
          Save status and next step
        </button>
        <button
          type="button"
          className={field}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
