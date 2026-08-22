import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { EventChecklistForm } from "@/components/manager/event-checklist-form";
import {
  completeChecklist,
  loadOrStartChecklist,
  markChecklistUnable,
  phaseFromSlug,
  type ManagerChecklist,
} from "@/features/manager/event-checklist-client";
import { useManagerAuth } from "@/lib/manager-auth-context";

export default function ManagerEventChecklistPage({
  bookingId,
  phaseSlug,
}: {
  bookingId: string;
  phaseSlug: string;
}) {
  const { managerApi } = useManagerAuth();
  const [, navigate] = useLocation();
  const phase = phaseFromSlug(phaseSlug);
  const [checklist, setChecklist] = useState<ManagerChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showUnable, setShowUnable] = useState(false);
  const [unableReason, setUnableReason] = useState("");

  const refresh = useCallback(async () => {
    if (!phase) return;
    const next = await loadOrStartChecklist(managerApi, bookingId, phase);
    setChecklist(next);
  }, [bookingId, managerApi, phase]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!phase) {
      setError("Unknown checklist phase.");
      setLoading(false);
      return;
    }
    loadOrStartChecklist(managerApi, bookingId, phase)
      .then((next) => { if (active) setChecklist(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load checklist."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bookingId, managerApi, phase]);

  async function complete() {
    if (!phase || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await completeChecklist(managerApi, bookingId, phase);
      setChecklist(result.checklist);
      navigate("/manager");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete checklist.");
    } finally {
      setBusy(false);
    }
  }

  async function unable() {
    if (!phase || phase !== "post_event" || busy) return;
    if (!unableReason.trim()) {
      setError("Add a reason before marking the post-event checklist unable to complete.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await markChecklistUnable(managerApi, bookingId, phase, unableReason);
      setChecklist(result.checklist);
      navigate("/manager");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save checklist exception.");
    } finally {
      setBusy(false);
    }
  }

  const title = phase === "pre_event" ? "Pre-event safety checklist" : "Post-event condition checklist";
  const description = phase === "pre_event"
    ? "Complete this after check-in and before the event is treated as ready to operate. Unsafe attraction results take that attraction out of service; site-wide unsafe conditions block Ready to Operate."
    : "Complete this during load-out before final checkout. Record new damage, missing equipment, cleaning/drying needs, and whether each assigned resource is safe for its next event.";

  if (loading) return <p className="text-sm text-slate-500">Loading checklist…</p>;
  if (!phase) return <p className="rounded-xl bg-rose-50 p-4 text-rose-800">Unknown checklist phase.</p>;

  return (
    <div className="grid gap-5 pb-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Event safety</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      </header>

      {checklist ? (
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-slate-100 px-3 py-1">{checklist.state.replaceAll("_", " ")}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{checklist.items.filter((item) => item.result !== null).length}/{checklist.items.length} answered</span>
        </div>
      ) : null}

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      {checklist ? <EventChecklistForm checklist={checklist} onRefresh={refresh} /> : null}

      {checklist?.state === "in_progress" ? (
        <section className="sticky bottom-20 z-10 grid gap-2 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <button className="button-primary min-h-12" disabled={busy} onClick={() => void complete()} type="button">
            {busy ? "Checking…" : phase === "pre_event" ? "Mark checklist complete" : "Complete checklist"}
          </button>
          {phase === "post_event" ? (
            showUnable ? (
              <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <label className="grid gap-1 text-sm font-bold text-amber-950">
                  Why can’t this checklist be completed?
                  <textarea className="min-h-24 bg-white" onChange={(event) => setUnableReason(event.currentTarget.value)} value={unableReason} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="button-secondary" disabled={busy || !unableReason.trim()} onClick={() => void unable()} type="button">Save exception</button>
                  <button className="button-secondary" disabled={busy} onClick={() => setShowUnable(false)} type="button">Cancel</button>
                </div>
              </div>
            ) : (
              <button className="button-secondary min-h-11" disabled={busy} onClick={() => setShowUnable(true)} type="button">Unable to complete</button>
            )
          ) : null}
          <p className="text-xs text-slate-500">Completion is verified by the server so unresolved safety follow-up cannot be accidentally skipped.</p>
        </section>
      ) : checklist ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-bold text-emerald-900">Checklist {checklist.state === "completed" ? "complete" : "exception recorded"}.</p>
          {checklist.unableReason ? <p className="mt-1 text-sm text-emerald-900">Reason: {checklist.unableReason}</p> : null}
          <Link className="button-primary mt-3 inline-flex" href="/manager">Return to event</Link>
        </section>
      ) : null}
    </div>
  );
}
