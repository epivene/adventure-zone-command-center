import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { captureOptionalEventLocation } from "@/features/manager/event-location";

type Lifecycle = {
  bookingId: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  wrapUpStatus: "not_started" | "incomplete" | "finished";
};

function time(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function EventLifecycleAction({ bookingId, compact = false, onChanged }: { bookingId: string; compact?: boolean; onChanged?: (lifecycle: Lifecycle) => void }) {
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

  async function action(kind: "check-in" | "check-out") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const location = await captureOptionalEventLocation();
      const result = await managerApi<{ lifecycle: Lifecycle }>(`/manager/events/${bookingId}/${kind}`, {
        method: "POST",
        body: JSON.stringify(location),
      });
      setLifecycle(result.lifecycle);
      onChanged?.(result.lifecycle);
      if (kind === "check-out") navigate(`/manager/events/${bookingId}/wrap-up`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${kind === "check-in" ? "check in" : "check out"}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return compact ? null : <p className="text-sm text-slate-500">Loading event status…</p>;
  if (lifecycle?.wrapUpStatus === "finished") return <p className="text-sm font-semibold text-emerald-700">Event wrap-up finished</p>;
  if (lifecycle?.checkedOutAt) return <div className="grid gap-1"><p className="text-sm font-semibold text-amber-700">Checked out {time(lifecycle.checkedOutAt)}</p><Link className="button-primary w-fit" href={`/manager/events/${bookingId}/wrap-up`}>Finish event wrap-up</Link>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
  if (lifecycle?.checkedInAt) return <div className="grid gap-1"><p className="text-sm font-semibold text-emerald-700">Checked in {time(lifecycle.checkedInAt)}</p><button className="button-primary w-fit" disabled={busy} type="button" onClick={() => void action("check-out")}>{busy ? "Checking out…" : "Check out"}</button>{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
  return <div className="grid gap-1"><button className="button-primary w-fit" disabled={busy} type="button" onClick={() => void action("check-in")}>{busy ? "Checking in…" : "Check in"}</button>{!compact ? <p className="text-xs text-slate-500">Location is optional. Check-in still works if location permission is off.</p> : null}{error ? <p className="text-sm text-red-700">{error}</p> : null}</div>;
}
