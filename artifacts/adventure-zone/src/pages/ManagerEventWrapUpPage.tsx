import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { EventWrapUpFinanceCheck } from "@/components/manager/event-wrap-up-finance-check";
import { EventWrapUpProfitability } from "@/components/manager/event-wrap-up-profitability";
import { EventWrapUpRating } from "@/components/manager/event-wrap-up-rating";
import { EventWrapUpSettlement } from "@/components/manager/event-wrap-up-settlement";
import { useManagerAuth } from "@/lib/manager-auth-context";

function dollars(cents: number | null | undefined) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

type Payload = any;

export default function ManagerEventWrapUpPage({ bookingId }: { bookingId: string }) {
  const { managerApi } = useManagerAuth();
  const [, navigate] = useLocation();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [differenceNote, setDifferenceNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function apply(next: Payload) {
    setPayload(next);
    setStars(next.wrapUp?.ratingStars ?? null);
    setNotes(next.wrapUp?.ratingNotes ?? "");
    setActualCash(dollars(next.wrapUp?.actualCashOnHandCents));
    setDifferenceNote(next.wrapUp?.cashDifferenceNote ?? "");
  }

  useEffect(() => {
    setError("");
    managerApi<Payload>(`/manager/wrap-ups/${bookingId}`).then(apply).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load event wrap-up"));
  }, [bookingId, managerApi]);

  const editable = payload?.wrapUp?.status !== "submitted" && payload?.wrapUp?.status !== "reviewed";
  const actualCashCents = useMemo(() => {
    if (!actualCash.trim()) return null;
    const value = Math.round(Number(actualCash) * 100);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }, [actualCash]);

  async function persistDraft() {
    const next = await managerApi<Payload>(`/manager/wrap-ups/${bookingId}`, {
      method: "PUT",
      body: JSON.stringify({
        ratingStars: stars,
        ratingNotes: notes.trim() || null,
        actualCashOnHandCents: actualCashCents,
        cashDifferenceNote: differenceNote.trim() || null,
      }),
    });
    apply(next);
    return next;
  }

  async function saveDraft() {
    if (!payload || !editable) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await persistDraft();
      setMessage("Draft saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save draft"); }
    finally { setBusy(false); }
  }

  async function finishLater() {
    if (!payload) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (editable) await persistDraft();
      await managerApi(`/manager/events/${bookingId}/wrap-up/finish-later`, { method: "POST", body: "{}" });
      navigate("/manager");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this wrap-up for later"); }
    finally { setBusy(false); }
  }

  async function finishWrapUp() {
    if (!payload || stars === null || actualCashCents === null) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (editable) await persistDraft();
      await managerApi(`/manager/events/${bookingId}/wrap-up/review`, {
        method: "POST",
        body: JSON.stringify({ rating: stars, feedback: notes.trim() || null, clientMutationId: crypto.randomUUID() }),
      });
      if (editable) {
        const next = await managerApi<Payload>(`/manager/wrap-ups/${bookingId}/submit`, { method: "POST", body: "{}" });
        apply(next);
      }
      await managerApi(`/manager/events/${bookingId}/wrap-up/finish`, { method: "POST", body: "{}" });
      navigate("/manager");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not finish event wrap-up"); }
    finally { setBusy(false); }
  }

  if (error && !payload) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</p>;
  if (!payload) return <p>Loading event wrap-up…</p>;

  const nonCashCents = payload.finance.squareCents + Math.max(0, payload.finance.otherCents);
  const profitabilityWarnings = new Set<string>(payload.calculation.trueProfit.incompleteReasons ?? []);
  const closeoutWarnings = (payload.warnings ?? []).filter((warning: string) => !profitabilityWarnings.has(warning));

  return <div className="mx-auto grid max-w-4xl gap-4">
    <header className="grid gap-1">
      <p className="text-sm font-bold uppercase tracking-wider text-orange-700">Post-event closeout</p>
      <h1 className="text-2xl font-bold">Event Wrap-Up</h1>
      <h2 className="text-xl font-semibold">{payload.event.name}</h2>
      <p className="text-sm text-slate-600">{payload.event.city}, {payload.event.region} · {payload.event.legName}{payload.event.tripName ? ` · ${payload.event.tripName}` : ""}</p>
      <p className="text-sm text-slate-600">Finish it now or save it and come back from Home or Schedule.</p>
      <span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-wide">{payload.wrapUp?.status ?? "draft"}</span>
    </header>

    {payload.wrapUp?.status === "submitted" ? <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 font-semibold text-blue-800">Submitted for admin review</p> : null}
    {payload.wrapUp?.status === "reviewed" ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800">Reviewed and closed</p> : null}
    {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold">Wrap-up checklist</h2>
      <p className="mt-1 text-sm text-slate-600">Use these shortcuts for anything that happened at this event, then come back here to finish.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Link className="button-secondary text-center" href={`/manager/receipts?bookingId=${encodeURIComponent(bookingId)}`}>Receipt / expense</Link>
        <Link className="button-secondary text-center" href="/manager/crew">Crew notes</Link>
        <Link className="button-secondary text-center" href={`/manager/incidents/new?bookingId=${encodeURIComponent(bookingId)}`}>Report issue</Link>
      </div>
    </section>

    <EventWrapUpRating stars={stars} notes={notes} disabled={!editable} onStarsChange={setStars} onNotesChange={setNotes} />
    <EventWrapUpSettlement expectedCashCents={payload.calculation.settlement.expectedCashCents} nonCashCents={nonCashCents} actualCash={actualCash} differenceNote={differenceNote} disabled={!editable} onActualCashChange={setActualCash} onDifferenceNoteChange={setDifferenceNote} />
    <EventWrapUpFinanceCheck payload={payload} />
    <EventWrapUpProfitability calculation={payload.calculation} />

    {closeoutWarnings.length ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-bold">Before you finish</h2><ul className="mt-2 list-disc pl-5 text-sm">{closeoutWarnings.map((warning: string) => <li key={warning}>{warning}</li>)}</ul></section> : null}

    <section className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
      {editable ? <button type="button" className="button-secondary" disabled={busy} onClick={() => void saveDraft()}>{busy ? "Saving…" : "Save draft"}</button> : null}
      <button type="button" className="button-secondary" disabled={busy} onClick={() => void finishLater()}>Finish later</button>
      <button type="button" className="button-primary" disabled={busy || stars === null || actualCashCents === null} onClick={() => void finishWrapUp()}>Finish wrap-up</button>
    </section>
  </div>;
}
