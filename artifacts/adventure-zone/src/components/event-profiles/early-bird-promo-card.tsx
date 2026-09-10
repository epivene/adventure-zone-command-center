import { useState } from "react";

import { apiPost } from "@/lib/auth-token";

export type EarlyBirdPromoView = {
  id: string;
  name: "Early Bird Promo";
  organizationId: string;
  bookingId: string | null;
  eventYear: number;
  status: "active" | "secured" | "expired" | "cancelled";
  firstSentAt: string;
  deadlineDate: string;
  interestConfirmedAt: string | null;
  reminderDueAt: string | null;
  reminderPrepared: boolean;
  depositReceivedAt: string | null;
  cancelReason: string | null;
};

function displayDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "America/Chicago",
  }).format(new Date(`${date}T12:00:00-05:00`));
}

export function EarlyBirdPromoCard({
  promotion,
  onChanged,
}: {
  promotion: EarlyBirdPromoView;
  onChanged: (promotion: EarlyBirdPromoView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  async function act(path: "interest" | "deposit" | "cancel", body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await apiPost<{ promotion: EarlyBirdPromoView }>(`/early-bird-promo/${promotion.id}/${path}`, body);
      onChanged(result.promotion);
      setCancelling(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Early Bird Promo could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const active = promotion.status === "active";
  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm" aria-labelledby="early-bird-promo-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">10% off</p>
          <h2 className="mt-1 text-xl font-bold" id="early-bird-promo-title">Early Bird Promo</h2>
          <p className="mt-1 text-sm text-slate-700">Deposit deadline: <strong>{displayDate(promotion.deadlineDate)}</strong></p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${promotion.status === "secured" ? "bg-emerald-100 text-emerald-800" : "bg-white text-orange-800"}`}>
          {promotion.status === "secured" ? "Promo secured" : promotion.status === "active" ? "Active" : promotion.status === "expired" ? "Expired" : "Cancelled"}
        </span>
      </div>
      {promotion.interestConfirmedAt && active ? (
        <p className="mt-3 text-sm font-semibold text-slate-800">Interest confirmed{promotion.reminderPrepared ? " · 15-day reminder prepared for review" : " · reminder will be prepared at day 15"}</p>
      ) : null}
      {promotion.cancelReason ? <p className="mt-3 text-sm text-slate-700">Reason: {promotion.cancelReason}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {active ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!promotion.interestConfirmedAt ? <button className="button-secondary" disabled={busy} onClick={() => void act("interest", {})} type="button">Mark interest confirmed</button> : null}
          <button className="button-primary" disabled={busy} onClick={() => void act("deposit", { source: "owner_profile" })} type="button">Record deposit</button>
          <button className="button-secondary text-rose-700" disabled={busy} onClick={() => setCancelling(true)} type="button">Cancel promo</button>
        </div>
      ) : null}
      {cancelling ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-rose-200 bg-white p-3">
          <label className="grid gap-1 text-sm font-semibold">Cancellation reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <div className="flex gap-2">
            <button className="button-secondary text-rose-700" disabled={busy || !reason.trim()} onClick={() => void act("cancel", { reason: reason.trim() })} type="button">Confirm cancellation</button>
            <button className="button-secondary" disabled={busy} onClick={() => setCancelling(false)} type="button">Keep promo</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
