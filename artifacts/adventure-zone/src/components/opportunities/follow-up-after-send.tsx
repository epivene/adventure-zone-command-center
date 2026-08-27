import { useState } from "react";

import { apiPost } from "@/lib/auth-token";

type Props = {
  opportunityId: string;
  referenceAt: string;
  onDone?: () => void;
};

type CreateFollowUpResponse = {
  ok: true;
  followUp: { id: string };
};

function addDays(referenceAt: string, days: number): Date {
  const dueAt = new Date(referenceAt);
  dueAt.setUTCDate(dueAt.getUTCDate() + days);
  return dueAt;
}

export function FollowUpAfterSend({ opportunityId, referenceAt, onDone }: Props) {
  const [customDueAt, setCustomDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFollowUp(dueAt: Date) {
    if (!Number.isFinite(dueAt.getTime())) {
      setError("Choose a valid follow-up date and time.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiPost<CreateFollowUpResponse>("/follow-ups", {
        opportunityId,
        kind: "email",
        dueAt: dueAt.toISOString(),
      });
      onDone?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the follow-up.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4" aria-labelledby="follow-up-after-send-title">
      <div>
        <h4 className="font-bold" id="follow-up-after-send-title">Follow up if no reply?</h4>
        <p className="text-sm text-slate-600">Add the next email follow-up to this Opportunity.</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800" role="alert">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button className="button-secondary" disabled={busy} type="button" onClick={() => void createFollowUp(addDays(referenceAt, 3))}>3 days</button>
        <button className="button-secondary" disabled={busy} type="button" onClick={() => void createFollowUp(addDays(referenceAt, 7))}>7 days</button>
        <button className="button-secondary" disabled={busy} type="button" onClick={() => onDone?.()}>No follow-up</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-semibold">
          Pick date & time
          <input
            aria-label="Follow-up date and time"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
            disabled={busy}
            type="datetime-local"
            value={customDueAt}
            onChange={(event) => setCustomDueAt(event.target.value)}
          />
        </label>
        <button
          className="button-secondary"
          disabled={busy || !customDueAt}
          type="button"
          onClick={() => void createFollowUp(new Date(customDueAt))}
        >
          Set custom follow-up
        </button>
      </div>
    </section>
  );
}
