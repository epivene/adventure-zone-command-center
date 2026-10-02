import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { getPlanner, type Planner } from "@/features/outreach-planner/outreach-api";
import { buildLegCallList, legCallWorkspaceHref, type CallListFollowUp, type LegCallRow } from "@/features/today/leg-call-list";
import { eventProfileHref } from "@/components/today/next-call-card";
import { BookingOperations } from "@/components/today/booking-operations";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

const filterKey = "adventure-zone:leg-call-list-filter";
type Filter = { season: string; legId: string };
function readFilter(): Filter {
  try {
    const value = JSON.parse(sessionStorage.getItem(filterKey) ?? "null");
    if (typeof value?.season === "string" && typeof value?.legId === "string") return value;
  } catch { /* Keep the list usable when storage is unavailable. */ }
  return { season: "all", legId: "all" };
}
function dateLabel(value: string | null) {
  return value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(new Date(value))
    : "Not recorded";
}
type ContactReview = {
  context: {
    organization: { lastResort: boolean; lastResortReason: string | null } | null;
    contact: { id: string; firstName: string; lastName: string } | null;
  };
  phones: { id: string; number: string; extension: string | null; doNotCallAt: string | null }[];
  operations: ComponentProps<typeof BookingOperations>["operations"];
};
function ContactPreview({ row }: { row: LegCallRow }) {
  const [review, setReview] = useState<ContactReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setReview(null);
    setError(null);
    apiGet<ContactReview>(legCallWorkspaceHref(row)).then(
      (value) => { if (active) setReview(value); },
      () => { if (active) setError("Could not check this contact. Retry before calling."); },
    );
    return () => { active = false; };
  }, [row.id, row.bookingId, row.followUpId, row.contactId, revision]);
  if (error) return <div role="alert"><p>{error}</p><button type="button" className="button-secondary" onClick={() => setRevision((value) => value + 1)}>Retry contact check</button></div>;
  if (!review) return <p role="status">Checking current contact and phone restrictions…</p>;
  const phones = review.phones.filter((phone) => !phone.doNotCallAt && phone.number.trim());
  const blocked = review.context.organization?.lastResort;
  const callAllowed = !blocked && !row.reviewReason && review.context.contact && phones.length > 0;
  return (
    <div className="grid gap-2">
      <p className="font-semibold">Recorded contact: {review.context.contact ? review.context.contact.firstName + " " + review.context.contact.lastName : "Needs selection"}</p>
      {blocked ? <p className="font-semibold text-rose-700">Last Resort — do not call. {review.context.organization?.lastResortReason}</p> : phones.length ? <p>Phone: {phones.map((phone) => phone.number + (phone.extension ? " ext. " + phone.extension : "")).join(" · ")}</p> : <p>No callable phone is recorded. Review the profile.</p>}
      <BookingOperations operations={review.operations} />
      <p className="text-sm">Confirm this is the current organizer. Check the operating plan before promising dates, packages or crew.</p>
      {callAllowed ? <Link className="button-primary w-fit" href={legCallWorkspaceHref({ ...row, contactId: review.context.contact!.id })}>Open call and save outcome</Link> : null}
    </div>
  );
}
function CallRow({ row, callingEnabled }: { row: LegCallRow; callingEnabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const profileHref = eventProfileHref({ organizationId: row.organizationId, contactId: row.contactId, bookingId: row.bookingId, followUpId: row.followUpId });
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-bold">{row.name}</h3><p className="text-sm">{row.season ?? "Season needs review"} · {row.followUpId ? "Assigned leg: " : "Suggested leg: "}{row.legName}</p></div>
        {profileHref ? <Link className="button-secondary" href={profileHref}>Event profile</Link> : null}
      </div>
      <p className="mt-2 text-sm">Why: {row.reason}</p>
      <p className="text-sm">{row.followUpId ? "Last recorded activity: " : "Last recorded contact: "}{dateLabel(row.lastContactAt)}{row.dueAt ? " · Next action due: " + dateLabel(row.dueAt) : ""}</p>
      {row.contactName ? <p className="text-sm">Recorded contact: {row.contactName}</p> : null}
      {row.packages.length ? <p className="text-sm">Suggested packages: {row.packages.join(" · ")}</p> : null}
      {row.openingLabels.length ? <p className="text-sm">Route openings: {row.openingLabels.join("; ")}</p> : null}
      {row.reviewReason ? <p className="mt-2 font-semibold text-amber-800">Review before calling: {row.reviewReason}</p> : null}
      <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Questions to ask</summary><ul className="mt-2 list-disc pl-5">{row.questions.map((question) => <li key={question}>{question}</li>)}</ul></details>
      {callingEnabled ? <button type="button" className="button-secondary mt-3" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Close contact review" : "Review contact and phone"}</button> : null}
      {expanded && callingEnabled ? <div className="mt-3 rounded-lg bg-slate-50 p-3"><ContactPreview row={row} /></div> : null}
    </li>
  );
}
export function LegCallList({ followUps, followUpTotal, now, callingEnabled = true }: { followUps: CallListFollowUp[]; followUpTotal?: number; now: Date; callingEnabled?: boolean }) {
  const [planner, setPlanner] = useState<Planner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>(readFilter);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setPlanner(null);
    getPlanner().then(
      (value) => { if (active) { setPlanner(value); setLoading(false); } },
      () => { if (active) { setError(true); setLoading(false); } },
    );
    return () => { active = false; };
  }, [revision, followUps]);
  function changeFilter(value: Filter) {
    setFilter(value);
    try { sessionStorage.setItem(filterKey, JSON.stringify(value)); } catch { /* Navigation stays usable. */ }
  }
  const rows = buildLegCallList(followUps, planner, now, filter);
  const years = [...new Set(planner?.candidates.map((candidate) => String(candidate.eventYear)) ?? [])].sort();
  if (filter.season !== "all" && !years.includes(filter.season)) years.push(filter.season);
  const legs = new Map((planner?.legs ?? []).map((leg) => [leg.id, leg.name]));
  for (const followUp of followUps) {
    const leg = followUp.routeLeg ?? followUp.operations?.leg;
    if (leg) legs.set(leg.id, leg.name);
  }
  if (filter.legId !== "all" && !legs.has(filter.legId)) legs.set(filter.legId, "Saved leg (not in this view)");
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Leg call list">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Leg call list</h2><button className="button-secondary" type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Refresh call list</button></div>
      <p className="mt-2 text-sm text-slate-600">Due calls first, then ranked prospects for open route dates. Suggested packages require a crew, equipment and travel check. Save the outcome and next action in the call workspace.</p>
      <div className="my-4 flex flex-wrap gap-3">
        <label className="text-sm font-semibold">Season <select className="ml-2 rounded border p-2" value={filter.season} onChange={(event) => changeFilter({ ...filter, season: event.target.value })}><option value="all">All seasons</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
        <label className="text-sm font-semibold">Leg <select className="ml-2 rounded border p-2" value={filter.legId} onChange={(event) => changeFilter({ ...filter, legId: event.target.value })}><option value="all">All legs</option>{[...legs].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      </div>
      {!callingEnabled ? <p className="mb-3 text-sm text-amber-800">The call workspace is unavailable. Open the event profile to review contacts and next actions.</p> : null}
      {loading ? <p role="status">Loading route prospects…</p> : null}
      {error ? <p role="alert">Route prospects could not load. Showing loaded due calls; refresh to retry.</p> : null}
      {planner && !planner.enabled ? <p className="text-sm text-amber-800">Route prospect planning is unavailable. Showing loaded due calls.</p> : null}
      {(followUpTotal ?? followUps.length) > followUps.length ? <p className="text-sm text-amber-800">This list uses {followUps.length} loaded reminders of {followUpTotal}. Other pages may contain calls or scheduled callbacks. Review the complete follow-up list before outreach.</p> : null}
      {filter.season !== "all" ? <p className="mb-3 text-sm text-slate-600">Callbacks with an unconfirmed season remain visible for review.</p> : null}
      {rows.length ? <ol className="grid gap-3">{rows.map((row) => <CallRow key={row.id + ":" + row.legId} row={row} callingEnabled={callingEnabled} />)}</ol> : !loading ? <p>No calls or prospect reviews match these filters.</p> : null}
    </section>
  );
}
