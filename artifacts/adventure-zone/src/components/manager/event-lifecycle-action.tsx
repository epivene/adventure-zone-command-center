import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { captureOptionalEventLocation } from "@/features/manager/event-location";

type ChecklistState = "not_started" | "in_progress" | "completed" | "unable_to_complete";
type Lifecycle = {
  bookingId: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  wrapUpStatus: "not_started" | "incomplete" | "finished";
  preEventChecklistState?: ChecklistState;
  postEventChecklistState?: ChecklistState;
  readyToOperate?: boolean;
  hasSiteWideUnsafeIssue?: boolean;
  hasChecklistFollowUpNeedsAttention?: boolean;
};

function time(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function EventLifecycleAction({ bookingId, compact = false, allowCheckIn = true, checkoutDueAt = null, onChanged }: { bookingId: string; compact?: boolean; allowCheckIn?: boolean; checkoutDueAt?: string | null; onChanged?: (lifecycle: Lifecycle) => void }) {
  const { managerApi } = useManagerAuth();
  const [, navigate] = useLocation();
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    managerApi<{ lifecycle: Lifecycle | null }>(`/manager/events/${bookingId}/lifecycle`)
      .then((result) => { if (active) setLifecycle(result.lifecycle); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load event status"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bookingId, managerApi]);

  async function checkIn() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const location = await captureOptionalEventLocation();
      const result = await managerApi<{ lifecycle: Lifecycle; nextAction?: string }>(`/manager/events/${bookingId}/check-in`, {
        method: "POST",
        body: JSON.stringify({
          ...location,
          timeZone: deviceTimeZone(),
          clientMutationId: crypto.randomUUID(),
        }),
      });
      setLifecycle(result.lifecycle);
      onChanged?.(result.lifecycle);
      navigate(`/manager/events/${bookingId}/checklist/pre-event`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check in");
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await managerApi<{ lifecycle: Lifecycle }>(`/manager/events/${bookingId}/checkout/start`, {
        method: "POST",
        body: JSON.stringify({ clientMutationId: crypto.randomUUID() }),
      });
      setLifecycle(result.lifecycle);
      onChanged?.(result.lifecycle);
      navigate(`/manager/events/${bookingId}/checklist/post-event`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout");
    } finally {
      setBusy(false);
    }
  }

  async function completeCheckout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const location = await captureOptionalEventLocation();
      const result = await managerApi<{ lifecycle: Lifecycle }>(`/manager/events/${bookingId}/check-out`, {
        method: "POST",
        body: JSON.stringify({ ...location, timeZone: deviceTimeZone(), clientMutationId: crypto.randomUUID() }),
      });
      setLifecycle(result.lifecycle);
      onChanged?.(result.lifecycle);
      navigate(`/manager/events/${bookingId}/wrap-up`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete checkout");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return compact ? null : <p className="text-sm text-slate-500">Loading event status…</p>;
  if (lifecycle?.wrapUpStatus === "finished") return <p className="text-sm font-semibold text-emerald-700">Manager event report complete</p>;
  if (lifecycle?.checkedOutAt) return <div className="grid gap-1"><p className="text-sm font-semibold text-amber-700">Checked out {time(lifecycle.checkedOutAt)}</p><Link className="button-primary w-fit" href={`/manager/events/${bookingId}/wrap-up`}>Finish manager event report</Link>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;

  if (lifecycle?.checkedInAt) {
    const checkoutDueTime = checkoutDueAt ? new Date(checkoutDueAt).getTime() : Number.NaN;
    const checkoutLate = Number.isFinite(checkoutDueTime) && Date.now() >= checkoutDueTime;
    const checkoutLateNotice = checkoutLate
      ? <p className="text-sm font-bold text-rose-700">Event over — checkout late</p>
      : null;
    const preState = lifecycle.preEventChecklistState ?? "not_started";
    const postState = lifecycle.postEventChecklistState ?? "not_started";
    if (preState !== "completed") {
      return <div className="grid gap-2">{checkoutLateNotice}<p className="text-sm font-semibold text-emerald-700">Checked in {time(lifecycle.checkedInAt)}</p><Link className="button-primary w-fit" href={`/manager/events/${bookingId}/checklist/pre-event`}>Finish pre-event checklist</Link>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
    }
    if (postState === "in_progress") {
      return <div className="grid gap-2">{checkoutLateNotice}{lifecycle.readyToOperate ? <p className="text-sm font-semibold text-emerald-700">Pre-event checklist complete · Ready to operate</p> : <p className="text-sm font-semibold text-rose-700">Pre-event checklist complete · Ready to operate is blocked by a safety condition</p>}<Link className="button-primary w-fit" href={`/manager/events/${bookingId}/checklist/post-event`}>Finish post-event checklist</Link>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
    }
    if (postState === "completed" || postState === "unable_to_complete") {
      return <div className="grid gap-2">{checkoutLateNotice}<p className="text-sm font-semibold text-amber-700">Post-event checklist {postState === "completed" ? "complete" : "exception recorded"}</p><button className="button-primary w-fit" disabled={busy} type="button" onClick={() => void completeCheckout()}>{busy ? "Completing checkout…" : "Complete checkout"}</button>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
    }
    return <div className="grid gap-2">{checkoutLateNotice ?? (lifecycle.readyToOperate ? <p className="text-sm font-semibold text-emerald-700">Ready to operate</p> : <p className="text-sm font-semibold text-rose-700">Ready to operate is blocked by a safety condition. Keep the affected attraction out of service and follow owner/admin direction.</p>)}<button className="button-primary w-fit" disabled={busy} type="button" onClick={() => void startCheckout()}>{busy ? "Starting checkout…" : "Start checkout"}</button>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
  }

  if (!allowCheckIn) return null;
  return <div className="grid gap-1"><button className="button-primary w-fit" disabled={busy} type="button" onClick={() => void checkIn()}>{busy ? "Checking in…" : "Check in"}</button>{!compact ? <p className="text-xs text-slate-500">Location is optional. Check-in still works if location permission is off. After arrival is saved, the pre-event safety checklist opens.</p> : null}{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
}
