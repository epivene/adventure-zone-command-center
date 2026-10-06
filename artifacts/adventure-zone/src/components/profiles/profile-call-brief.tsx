import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { briefTime, projectCallBrief, type CallBriefProfile } from "./profile-call-brief-model";

type BookingFacts = {
  bookingId: string; packages: string[]; contractStatus: string | null; termsSource: string | null;
  commercialTerms: { totalFeeCents?: number; guaranteeCents?: number; depositCents?: number; depositDueDate?: string; eventShareBasisPoints?: number } | null;
  invoiceStatus: string | null; totalCents: number | null; depositCents: number | null; paidCents: number | string; depositDueDate: string | null;
};
type Facts = { bookings: BookingFacts[]; holds: Array<{ contactId: string; number: string; reason: string | null }> };
type Email = { subject: string; date: string; internalDateMs: number | null; threadId: string };
const words = (value?: string | null) => value?.replaceAll("_", " ") || "Not recorded";
const money = (cents: number | null | undefined) => typeof cents === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100) : "Not recorded";
function date(value: Date | string | null | undefined) {
  const time = briefTime(value);
  return time ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(time)) : "Not recorded";
}

export function ProfileCallBrief({ profile, emails = [], readOnly = false, onEmails, onHistory, onDocuments, onAddNote }: {
  profile: CallBriefProfile; emails?: Email[]; readOnly?: boolean;
  onEmails?: () => void; onHistory?: () => void; onDocuments?: () => void; onAddNote?: () => void;
}) {
  const defaultYear = profile.effectiveEventDate ? Number(profile.effectiveEventDate.startsOn.slice(0, 4)) : new Date().getUTCFullYear();
  const [selection, setSelection] = useState({ profileId: profile.id, year: defaultYear, bookingId: "" });
  const year = selection.profileId === profile.id ? selection.year : defaultYear;
  const brief = projectCallBrief(profile, year);
  const booking = brief.bookings.find(item => item.id === selection.bookingId) ?? brief.bookings[0] ?? null;
  const years = [...new Set([defaultYear, new Date().getUTCFullYear(), ...profile.bookings.flatMap(item => briefTime(item.startsAt) ? [new Date(item.startsAt!).getUTCFullYear()] : [])])].sort((a, b) => b - a);
  const [facts, setFacts] = useState<{ profileId: string; value: Facts | null; error: boolean }>({ profileId: "", value: null, error: false });
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    setFacts({ profileId: profile.id, value: null, error: false });
    apiGet<Facts>(`/profiles/${profile.id}/call-brief`).then(value => {
      if (active) setFacts({ profileId: profile.id, value, error: false });
    }).catch(() => { if (active) setFacts({ profileId: profile.id, value: null, error: true }); });
    return () => { active = false; };
  }, [profile.id, readOnly]);
  const visibleFacts = facts.profileId === profile.id ? facts.value : null;
  const financial = visibleFacts?.bookings.find(item => item.bookingId === booking?.id);
  const terms = financial?.commercialTerms;
  const factsPending = !readOnly && (!facts.profileId || facts.profileId !== profile.id || (!facts.value && !facts.error));
  const factsUnavailable = facts.profileId === profile.id && facts.error;
  const missingFact = factsPending ? "Loading…" : factsUnavailable ? "Unavailable" : "Not recorded";
  const latestEmail = [...emails].sort((a, b) => (b.internalDateMs ?? briefTime(b.date)) - (a.internalDateMs ?? briefTime(a.date)))[0];
  const emailIsLatest = latestEmail && (latestEmail.internalDateMs ?? briefTime(latestEmail.date)) > briefTime(brief.discussion?.occurredAt);
  const discussionText = emailIsLatest ? latestEmail.subject : brief.discussion?.body;
  const discussionDate = emailIsLatest ? latestEmail.date || (latestEmail.internalDateMs ? new Date(latestEmail.internalDateMs) : null) : brief.discussion?.occurredAt;
  const start = booking?.startsAt ?? brief.date?.startsOn;
  const end = booking?.endsAt ?? brief.date?.endsOn;
  return <section aria-labelledby="profile-call-brief-title" className="rounded-xl border-l-4 border-primary bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="profile-call-brief-title" className="text-lg font-bold">Call brief</h2>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold">Event year <select className="ml-2 rounded border bg-background p-2" value={year} onChange={event => setSelection({ profileId: profile.id, year: Number(event.target.value), bookingId: "" })}>{years.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        {brief.bookings.length > 1 ? <label className="text-xs font-semibold">Booking <select className="ml-2 max-w-full rounded border bg-background p-2" value={booking?.id} onChange={event => setSelection({ profileId: profile.id, year, bookingId: event.target.value })}>{brief.bookings.map(item => <option key={item.id} value={item.id}>{item.name} · {date(item.startsAt)}</option>)}</select></label> : null}
      </div>
    </div>
    {visibleFacts?.holds.length ? <div role="note" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"><strong>Do not call:</strong> {visibleFacts.holds.map(item => `${item.number}${item.reason ? " — " + item.reason : ""}`).join("; ")}</div> : null}
    <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="text-xs text-muted-foreground">Primary contact</dt><dd className="font-semibold">{brief.contact?.name || "Not recorded"}</dd><dd className="text-xs">{brief.contact?.role}</dd>
        {brief.contact?.phone ? <dd><a className="text-primary underline" href={`tel:${brief.contact.phone}`}>{brief.contact.phone}</a></dd> : null}
        {brief.contact?.email ? <dd className="break-all">{brief.contact.email}</dd> : null}</div>
      <div><dt className="text-xs text-muted-foreground">Dates / status · {year}</dt><dd className="font-semibold">{date(start)}{end ? ` – ${date(end)}` : ""}</dd><dd>{booking ? words(booking.status) : brief.date ? `${words(brief.date.displayStatus)} date; no booking recorded` : "No booking recorded for this year"}</dd>
        {booking ? <dd><Link className="text-primary underline" href={`${readOnly ? "/boss" : ""}/bookings/${booking.id}`}>Open booking</Link></dd> : null}</div>
      <div><dt className="text-xs text-muted-foreground">Next action</dt><dd className="font-semibold">{words(brief.nextAction?.kind)}</dd>{brief.nextAction?.dueAt ? <dd>Due {date(brief.nextAction.dueAt)}</dd> : null}</div>
      {!readOnly ? <>
        <div><dt className="text-xs text-muted-foreground">Package</dt><dd className="font-semibold">{financial?.packages.join(", ") || missingFact}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Recorded terms / invoice</dt><dd className="font-semibold">{factsPending || factsUnavailable ? missingFact : money(terms?.totalFeeCents ?? terms?.guaranteeCents ?? financial?.totalCents)}</dd>
          {terms?.eventShareBasisPoints !== undefined ? <dd>Event share {terms.eventShareBasisPoints / 100}%</dd> : null}
          <dd className="text-xs text-muted-foreground">{financial?.termsSource === "draft" ? "Contract draft terms" : financial?.termsSource === "contract" ? "Contract terms" : financial?.invoiceStatus ? "Invoice amount" : "No amount recorded"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Contract / deposit</dt><dd className="font-semibold">{financial?.contractStatus ? words(financial.contractStatus) : missingFact}</dd><dd>Deposit {factsPending || factsUnavailable ? missingFact : money(financial?.depositCents ?? terms?.depositCents)}</dd>
          {financial?.invoiceStatus ? <dd>{words(financial.invoiceStatus)} · Received {money(Number(financial.paidCents))}</dd> : null}
          {financial?.depositDueDate || terms?.depositDueDate ? <dd>Due {date(financial?.depositDueDate || terms?.depositDueDate)}</dd> : null}</div>
      </> : null}
    </dl>
    {!readOnly && facts.error ? <p role="status" className="mt-2 text-xs text-muted-foreground">Booking amounts and contact holds are temporarily unavailable.</p> : null}
    <div className="mt-4 border-t pt-3">
      <p className="text-xs text-muted-foreground">Last recorded discussion{discussionText ? ` · ${date(discussionDate)}` : ""}</p>
      <p className="mt-1 line-clamp-3 text-sm">{discussionText || "No conversation recorded."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onEmails ? <button className="button-secondary" onClick={onEmails} type="button">Emails</button> : null}
        {onHistory ? <button className="button-secondary" onClick={onHistory} type="button">History</button> : null}
        {!readOnly && onDocuments ? <button className="button-secondary" onClick={onDocuments} type="button">Documents</button> : null}
        {!readOnly && onAddNote ? <button className="button-primary" onClick={onAddNote} type="button">Add note</button> : null}
      </div>
    </div>
  </section>;
}
