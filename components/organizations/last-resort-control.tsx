"use client";

import { useState } from "react";

import type { SetLastResortInput } from "@/features/organizations/last-resort-input";

type LastResortActionResult = { ok: true } | { ok: false; error: string };

export function LastResortControl({
  initialEnabled,
  initialReason,
  onSubmit,
  organizationId,
}: {
  initialEnabled: boolean;
  initialReason: string | null;
  onSubmit: (input: SetLastResortInput) => Promise<LastResortActionResult>;
  organizationId: string;
}) {
  const [reason, setReason] = useState(initialReason ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const enabled = !initialEnabled;
  const confirmationLabel = enabled
    ? "I confirm this account should be marked Last Resort."
    : "I confirm the Last Resort status should be cleared.";

  async function submit() {
    const normalizedReason = reason.trim();
    if (enabled && !normalizedReason) {
      setError("Add a Last Resort reason");
      return;
    }
    if (!confirmed) {
      setError(enabled ? "Confirm before marking Last Resort" : "Confirm before clearing");
      return;
    }

    setError(null);
    setPending(true);
    try {
      const result = await onSubmit({
        organizationId,
        enabled,
        reason: enabled ? normalizedReason : "",
      });
      if (!result.ok) setError(result.error);
    } catch {
      setError("Could not update Last Resort status. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Last Resort</h2>
      <p className="mt-1 text-sm text-slate-600">
        {initialEnabled
          ? "This account is currently marked Last Resort."
          : "Mark this account only when it should not receive routine follow-up."}
      </p>
      {enabled ? (
        <label className="mt-4 grid gap-1 text-sm font-semibold">
          Last Resort reason
          <textarea
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />
        </label>
      ) : (
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          Current reason: {initialReason || "Not recorded"}
        </p>
      )}
      <label className="mt-4 flex items-start gap-2 text-sm font-semibold">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>{confirmationLabel}</span>
      </label>
      {error ? (
        <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className={initialEnabled ? "button-secondary mt-4" : "button-primary mt-4"}
        disabled={pending}
        onClick={submit}
        type="button"
      >
        {pending
          ? "Saving…"
          : initialEnabled
            ? "Clear Last Resort"
            : "Mark as Last Resort"}
      </button>
    </section>
  );
}
