import { useState } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { LegEventRecordGroups } from "@/components/records/leg-event-record-groups";

function money(cents: number | null | undefined) {
  if (cents == null) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function difference(cents: number | null | undefined) {
  if (cents == null) return "Not counted";
  if (cents === 0) return "Balanced";
  return `${money(Math.abs(cents))} ${cents < 0 ? "short" : "over"}`;
}

function OrganizerFeedbackPanel({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const next = await apiGet<any>(`/organizer-feedback/admin/bookings/${bookingId}`);
      setData(next);
      setNoteDrafts((current) => {
        const merged = { ...current };
        for (const review of next.reviews ?? []) if (merged[review.id] === undefined) merged[review.id] = review.adminNotes ?? "";
        return merged;
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load organizer feedback"); }
  }
  async function toggle() { const next = !open; setOpen(next); if (next && !data) await load(); }
  async function prepare() {
    setBusy(true); setError(""); setMessage("");
    try {
      const next = await apiPost<any>(`/organizer-feedback/admin/bookings/${bookingId}/request`, {
        recipientName: recipientName.trim() || null,
        recipientEmail: recipientEmail.trim() || null,
      });
      setDraft(next); await load(); setMessage("Review email prepared. Nothing was sent.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare review email"); }
    finally { setBusy(false); }
  }
  async function saveAdminNote(reviewId: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await apiPatch(`/organizer-feedback/admin/${reviewId}/admin-notes`, { adminNotes: noteDrafts[reviewId]?.trim() || null });
      await load(); setMessage("Admin-only note saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save admin note"); }
    finally { setBusy(false); }
  }
  async function copy(value: string) { await navigator.clipboard.writeText(value); }

  return <div className="mt-3 border-t pt-3">
    <button className="button-secondary" type="button" onClick={() => void toggle()}>{open ? "Hide organizer feedback" : "Organizer feedback"}</button>
    {open ? <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3">
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {message ? <p className="text-sm font-semibold text-emerald-700" role="status">{message}</p> : null}
      {(data?.reviews ?? []).map((review: any) => <div key={review.id} className="rounded-lg border bg-white p-3">
        <div className="flex flex-wrap justify-between gap-2"><b>Organizer review</b><span className="text-amber-600" aria-label={`${review.overallRating} of 5 stars`}>{"★".repeat(review.overallRating)}{"☆".repeat(5-review.overallRating)}</span></div>
        <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2"><p><b>Professionalism:</b> {review.professionalismRating}/5</p><p><b>Setup:</b> {review.setupRating}/5</p><p><b>Communication:</b> {review.communicationRating}/5</p><p><b>Invite back:</b> {review.inviteBack}</p></div>
        {review.comments ? <p className="mt-2 rounded bg-slate-50 p-2 text-sm">“{review.comments}”</p> : null}
        {review.managerAcknowledgedAt ? <p className="mt-2 text-sm font-semibold text-emerald-700">✓ Leg manager acknowledged this review</p> : <p className="mt-2 text-sm text-amber-700">Waiting for leg manager acknowledgement</p>}
        {review.managerResponse ? <p className="mt-1 text-sm"><b>Manager response:</b> {review.managerResponse}</p> : null}
        <div className="mt-3 border-t pt-3"><label className="grid gap-1 text-sm font-semibold">Admin-only note<textarea rows={2} maxLength={5000} value={noteDrafts[review.id] ?? ""} onChange={(event)=>setNoteDrafts((current)=>({ ...current, [review.id]: event.target.value }))}/></label><button className="button-secondary mt-2" disabled={busy} type="button" onClick={() => void saveAdminNote(review.id)}>Save private note</button></div>
      </div>)}
      {(data?.requests?.length ?? 0) > 0 && !(data?.reviews?.length) ? <p className="text-sm text-slate-600">Review request prepared. Waiting for the organizer to submit feedback.</p> : null}
      <div className="grid gap-2 rounded-lg border bg-white p-3">
        <h4 className="font-bold">Prepare review email</h4>
        <p className="text-sm text-slate-600">Creates a private review link tied to this event and its assigned leg manager. Nothing is sent automatically.</p>
        <div className="grid gap-2 sm:grid-cols-2"><input aria-label="Organizer name" placeholder="Organizer name (optional)" value={recipientName} onChange={(e)=>setRecipientName(e.target.value)}/><input aria-label="Organizer email" placeholder="Organizer email (optional)" type="email" value={recipientEmail} onChange={(e)=>setRecipientEmail(e.target.value)}/></div>
        <button className="button-primary w-fit" disabled={busy} type="button" onClick={() => void prepare()}>{busy ? "Preparing…" : "Prepare review email"}</button>
      </div>
      {draft ? <div className="grid gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
        <h4 className="font-bold">Review email ready</h4>
        <p className="text-sm"><b>Subject:</b> {draft.subject}</p>
        <div className="flex flex-wrap gap-2"><button className="button-secondary" type="button" onClick={() => void copy(draft.subject)}>Copy subject</button><button className="button-secondary" type="button" onClick={() => void copy(draft.text)}>Copy email text</button><button className="button-secondary" type="button" onClick={() => void copy(draft.reviewUrl)}>Copy review link</button></div>
        <div className="rounded-lg bg-white p-3 text-center"><p className="font-semibold">Clickable star links in the branded email:</p><div className="mt-1 text-3xl text-amber-500">★★★★★</div><a className="mt-2 inline-block text-sm font-semibold text-orange-700 underline" href={draft.reviewUrl} rel="noreferrer" target="_blank">Preview review form</a></div>
      </div> : null}
    </div> : null}
  </div>;
}

export function EventWrapUpReviewQueue({ wrapUps }: { wrapUps: any[] }) {
  if (!wrapUps.length) return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">No submitted event wrap-ups are waiting for review.</p>;
  const groupedWrapUps = wrapUps.map((item) => ({
    ...item,
    id: item.event.bookingId,
    bookingId: item.event.bookingId,
    bookingName: item.event.name,
    legId: item.event.legId ?? null,
    legName: item.event.legName ?? null,
  }));
  return <LegEventRecordGroups records={groupedWrapUps} noun="review">
    {(item) => {
      const trueProfit = item.calculation?.trueProfit;
      const reasons = trueProfit?.incompleteReasons ?? [];
      return <article key={item.event.bookingId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{item.event.name}</h3><p className="text-sm text-slate-600">{item.event.legName}{item.event.startsAt ? ` · ${new Date(item.event.startsAt).toLocaleDateString()}` : ""}</p><p className="mt-2 text-xl text-amber-600" aria-label={`${item.wrapUp?.ratingStars ?? 0} stars`}>{"★".repeat(item.wrapUp?.ratingStars ?? 0)}</p></div><a className="button-primary" href={`/manager-aftermath?wrapUp=${encodeURIComponent(item.event.bookingId)}`}>Review wrap-up</a></div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><p><span className="font-semibold">Cash:</span> {difference(item.calculation?.settlement?.differenceCents)}</p><p><span className="font-semibold">Direct profit:</span> {money(item.calculation?.directProfit?.profitCents)}</p><p><span className="font-semibold">Estimated true profit:</span> {trueProfit?.profitCents == null ? "unavailable" : money(trueProfit.profitCents)}</p><p><span className="font-semibold">Submitted:</span> {item.wrapUp?.submittedAt ? new Date(item.wrapUp.submittedAt).toLocaleString() : "—"}</p></div>
        {item.finance?.missingReceiptCount ? <p className="mt-2 text-sm font-semibold text-amber-700">{item.finance.missingReceiptCount} receipt{item.finance.missingReceiptCount === 1 ? "" : "s"} missing or incomplete</p> : null}
        {reasons.map((reason: string) => <p key={reason} className="mt-1 text-sm font-semibold text-amber-700">{reason}</p>)}
        <OrganizerFeedbackPanel bookingId={item.event.bookingId} />
      </article>;
    }}
  </LegEventRecordGroups>;
}
