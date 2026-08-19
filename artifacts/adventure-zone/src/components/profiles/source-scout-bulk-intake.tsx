import { useMemo, useState } from "react";
import { Link } from "wouter";

import { apiPost } from "@/lib/auth-token";

type CrmMatch =
  | { status: "existing"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "possible_match"; organizationId: string; bookingId?: string; matchedName: string }
  | { status: "new_prospect" };

export type SourceScoutBulkEvent = {
  name: string;
  city: string | null;
  region: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  url: string;
  rationale: string;
  crmMatch?: CrmMatch;
};

export type SourceScoutBulkRun = {
  sourceUrl: string;
  sourceTitle: string | null;
  startDate: string;
  endDate: string;
  scoutedAt: string;
  events: SourceScoutBulkEvent[];
};

type CreatedProspect = {
  name: string;
  url: string;
  profileId: string;
  bookingId: string;
};

function keyFor(event: SourceScoutBulkEvent) {
  return `${event.url}|${event.name}|${event.startsAt ?? ""}`;
}

function eligibleForBulk(event: SourceScoutBulkEvent) {
  return event.crmMatch?.status === "new_prospect"
    && Boolean(event.city?.trim())
    && Boolean(event.region?.trim().length === 2)
    && /^https?:\/\//i.test(event.url);
}

function singleIntakeHref(event: SourceScoutBulkEvent) {
  const params = new URLSearchParams({
    source: "scout",
    name: event.name,
    city: event.city ?? "",
    region: event.region ?? "",
    sourceUrl: event.url,
    startsAt: event.startsAt ?? "",
    endsAt: event.endsAt ?? "",
  });
  return `/event-profiles/new?${params.toString()}`;
}

function reviewHref(event: SourceScoutBulkEvent) {
  if (event.crmMatch?.status === "existing" || event.crmMatch?.status === "possible_match") {
    return event.crmMatch.bookingId
      ? `/bookings/${event.crmMatch.bookingId}`
      : `/profiles/${event.crmMatch.organizationId}`;
  }
  return singleIntakeHref(event);
}

function dateLabel(event: SourceScoutBulkEvent) {
  if (!event.startsAt) return "Date not confirmed";
  return event.endsAt && event.endsAt !== event.startsAt
    ? `${event.startsAt} – ${event.endsAt}`
    : event.startsAt;
}

export function SourceScoutBulkIntake({ scout }: { scout: SourceScoutBulkRun }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nextActionKind, setNextActionKind] = useState("call");
  const [nextActionDueAt, setNextActionDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createdByUrl, setCreatedByUrl] = useState<Record<string, CreatedProspect>>({});

  const eligible = useMemo(
    () => scout.events.filter((event) => eligibleForBulk(event) && !createdByUrl[event.url]).slice(0, 20),
    [scout.events, createdByUrl],
  );

  function toggle(event: SourceScoutBulkEvent) {
    const key = keyFor(event);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < 20) next.add(key);
      return next;
    });
  }

  function selectAllNew() {
    setSelected(new Set(eligible.map(keyFor)));
  }

  async function createSelected() {
    if (busy || !selected.size || !nextActionDueAt) return;
    const events = scout.events.filter((event) => selected.has(keyFor(event)) && eligibleForBulk(event) && !createdByUrl[event.url]);
    if (!events.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiPost<{
        created: CreatedProspect[];
        skipped: Array<{ name: string; reason: string }>;
      }>("/profile-research/bulk-intake", {
        events: events.map(({ crmMatch: _crmMatch, ...event }) => event),
        nextActionKind,
        nextActionDueAt,
      });
      if (result.created.length) {
        setCreatedByUrl((current) => Object.fromEntries([
          ...Object.entries(current),
          ...result.created.map((item) => [item.url, item] as const),
        ]));
      }
      setSelected(new Set());
      const parts = [
        result.created.length ? `${result.created.length} lead${result.created.length === 1 ? "" : "s"} created` : "",
        result.skipped.length ? `${result.skipped.length} skipped after duplicate/data recheck` : "",
      ].filter(Boolean);
      setMessage(parts.join(" · ") || "No leads were created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the selected leads.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3">
      {eligible.length ? (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-3" aria-label="Bulk prospect intake">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-800">Bulk prospect intake</p>
              <p className="mt-1 text-sm text-blue-950">Select up to 20 New prospects and give them one shared first follow-up.</p>
            </div>
            <button className="text-xs font-semibold text-blue-800 hover:underline" type="button" onClick={selectAllNew}>Select all new</button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">First action<select className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={nextActionKind} onChange={(event) => setNextActionKind(event.target.value)}><option value="call">Call</option><option value="email">Email</option><option value="prepare_quote">Prepare quote</option></select></label>
            <label className="grid gap-1 text-sm font-semibold">First follow-up date<input className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" type="date" value={nextActionDueAt} onChange={(event) => setNextActionDueAt(event.target.value)} /></label>
            <div className="flex items-end"><button className="button-primary w-full" type="button" disabled={busy || !selected.size || !nextActionDueAt} onClick={() => void createSelected()}>{busy ? "Creating leads…" : `Create selected leads (${selected.size})`}</button></div>
          </div>
          {error ? <p className="mt-2 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
          {message ? <p className="mt-2 text-sm font-semibold text-emerald-800">{message}</p> : null}
        </section>
      ) : null}

      <div className="grid gap-2">
        {scout.events.length ? scout.events.map((event, index) => {
          const created = createdByUrl[event.url];
          const matchStatus = created ? "existing" : event.crmMatch?.status ?? "new_prospect";
          const canSelect = !created && eligibleForBulk(event);
          const key = keyFor(event);
          return (
            <article className="rounded-lg bg-slate-50 p-3" key={`${event.name}-${event.startsAt ?? index}`}>
              <div className="flex items-start gap-3">
                {canSelect ? <input className="mt-1 h-4 w-4" aria-label={`Select ${event.name}`} type="checkbox" checked={selected.has(key)} onChange={() => toggle(event)} /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="font-semibold text-slate-950">{event.name}</p><p className="mt-1 text-xs text-slate-600">{dateLabel(event)} · {[event.venue, [event.city, event.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "Location not confirmed"}</p></div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${matchStatus === "existing" ? "bg-emerald-100 text-emerald-800" : matchStatus === "possible_match" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{matchStatus === "existing" ? "Already in Command Center" : matchStatus === "possible_match" ? "Possible match" : "New prospect"}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{event.rationale}</p>
                  {!canSelect && matchStatus === "new_prospect" ? <p className="mt-2 text-xs font-semibold text-amber-800">Add a city and two-letter state before using bulk intake; you can still review this one individually.</p> : null}
                  <div className="mt-2 flex flex-wrap gap-3">
                    <a className="text-xs font-semibold text-orange-700 hover:underline" href={event.url} target="_blank" rel="noreferrer noopener">Open event source</a>
                    {created ? <Link className="text-xs font-semibold text-slate-700 hover:underline" href={`/profiles/${created.profileId}`}>Open in Command Center</Link> : matchStatus === "possible_match" ? <Link className="text-xs font-semibold text-slate-700 hover:underline" href={reviewHref(event)}>Review possible match</Link> : matchStatus === "existing" ? <Link className="text-xs font-semibold text-slate-700 hover:underline" href={reviewHref(event)}>Open in Command Center</Link> : <Link className="text-xs font-semibold text-slate-700 hover:underline" href={singleIntakeHref(event)}>Add as lead</Link>}
                  </div>
                </div>
              </div>
            </article>
          );
        }) : <p className="text-sm text-slate-600">No prospect-worthy events were found in this window.</p>}
      </div>
    </div>
  );
}
