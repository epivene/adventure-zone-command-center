import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ExternalLink, Search, X } from "lucide-react";

import { apiGet, apiPost } from "@/lib/auth-token";

type Source = {
  id: string;
  title: string;
  url: string | null;
  publisher: string | null;
  excerpt: string;
};

type Suggestion = {
  id: string;
  targetKind: "organization" | "contact" | "booking";
  targetId: string | null;
  field: string;
  currentValue: string | null;
  suggestedValue: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  sourceIds: string[];
  conflict: boolean;
  reviewStatus: "pending" | "accepted" | "dismissed";
};

type ResearchFinding = {
  label: string;
  value: string;
  rationale: string;
  sourceUrls: string[];
};

type RelatedEvent = {
  name: string;
  city: string | null;
  region: string | null;
  startsAt: string | null;
  endsAt: string | null;
  venue: string | null;
  url: string;
  rationale: string;
  crmMatch?:
    | { status: "existing"; organizationId: string; bookingId?: string; matchedName: string }
    | { status: "possible_match"; organizationId: string; bookingId?: string; matchedName: string }
    | { status: "new_prospect" };
};

type ResearchRun = {
  id: string;
  profileId: string;
  mode: "quick" | "deep";
  status: "running" | "complete" | "failed";
  failureMessage: string | null;
  summary: any;
  sources: Source[];
  suggestions: Suggestion[];
};

function labelField(value: string) {
  const labels: Record<string, string> = {
    website: "Website",
    phone: "Phone",
    address1: "Street address",
    address2: "Address line 2",
    city: "City",
    region: "State",
    postalCode: "ZIP / postal code",
    placeType: "Profile category",
    name: "Name",
    role: "Role / title",
    email: "Email",
    startsAt: "Event start",
    endsAt: "Event end",
  };
  return labels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function confidenceClass(confidence: Suggestion["confidence"]) {
  if (confidence === "high") return "bg-emerald-100 text-emerald-800";
  if (confidence === "medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function crmMatchLabel(match: RelatedEvent["crmMatch"]) {
  if (match?.status === "existing") return { label: "Already in Command Center", className: "bg-emerald-100 text-emerald-800" };
  if (match?.status === "possible_match") return { label: "Possible match", className: "bg-amber-100 text-amber-800" };
  return { label: "New prospect", className: "bg-blue-100 text-blue-800" };
}

function eventDateLabel(event: RelatedEvent) {
  if (!event.startsAt) return "Date not confirmed";
  return event.endsAt && event.endsAt !== event.startsAt ? `${event.startsAt} – ${event.endsAt}` : event.startsAt;
}

export function ProfileResearchPanel({
  profileId,
  contactId,
  onClose,
  onApplied,
}: {
  profileId: string;
  contactId?: string | null;
  onClose(): void;
  onApplied?: () => Promise<void> | void;
}) {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyMessage, setApplyMessage] = useState("");

  const sourceById = useMemo(() => new Map((run?.sources ?? []).map((source) => [source.id, source])), [run?.sources]);
  const sourceByUrl = useMemo(() => new Map((run?.sources ?? []).flatMap((source) => source.url ? [[source.url, source] as const] : [])), [run?.sources]);
  const pending = (run?.suggestions ?? []).filter((suggestion) => suggestion.reviewStatus === "pending");
  const findings = (run?.summary?.findings ?? []) as ResearchFinding[];
  const relatedEvents = (run?.summary?.relatedEvents ?? []) as RelatedEvent[];

  async function startResearch(nextMode = mode) {
    if (busy) return;
    setBusy(true);
    setError("");
    setApplyMessage("");
    try {
      const response = await apiPost<{ run: ResearchRun }>(`/event-profiles/${profileId}/research`, {
        mode: nextMode,
        ...(contactId ? { contactId } : {}),
      });
      setRun(response.run);
      setSelected(new Set(
        response.run.suggestions
          .filter((suggestion) => suggestion.reviewStatus === "pending" && suggestion.confidence === "high" && !suggestion.conflict)
          .map((suggestion) => suggestion.id),
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not research this profile.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshRun() {
    if (!run) return;
    const response = await apiGet<{ run: ResearchRun }>(`/event-profiles/${profileId}/research/${run.id}`);
    setRun(response.run);
  }

  async function applySelected() {
    if (!run || !selected.size || busy) return;
    setBusy(true);
    setError("");
    setApplyMessage("");
    try {
      const result = await apiPost<{ applied: string[]; stale: string[]; invalid: Array<{ id: string; error: string }>; missing: string[] }>(
        `/event-profiles/${profileId}/research/${run.id}/apply`,
        { suggestionIds: [...selected] },
      );
      const parts = [
        result.applied.length ? `${result.applied.length} added` : "",
        result.stale.length ? `${result.stale.length} need review because the profile changed` : "",
        result.invalid.length ? `${result.invalid.length} could not be validated` : "",
      ].filter(Boolean);
      setApplyMessage(parts.join(" · ") || "No changes were applied.");
      setSelected(new Set());
      await refreshRun();
      if (result.applied.length) await onApplied?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply those suggestions.");
    } finally {
      setBusy(false);
    }
  }

  async function applyHighConfidence() {
    if (!run || busy) return;
    setBusy(true);
    setError("");
    setApplyMessage("");
    try {
      const result = await apiPost<{ applied: string[]; stale: string[]; invalid: any[]; missing: string[] }>(
        `/event-profiles/${profileId}/research/${run.id}/apply-high-confidence`,
        {},
      );
      setApplyMessage(result.applied.length ? `${result.applied.length} high-confidence update${result.applied.length === 1 ? "" : "s"} added.` : "No safe high-confidence updates were ready to add.");
      setSelected(new Set());
      await refreshRun();
      if (result.applied.length) await onApplied?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the high-confidence suggestions.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(suggestionId: string) {
    if (!run || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/event-profiles/${profileId}/research/${run.id}/suggestions/${suggestionId}/dismiss`, {});
      setSelected((current) => { const next = new Set(current); next.delete(suggestionId); return next; });
      await refreshRun();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not dismiss that suggestion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Profile research">
      <div className="mx-auto min-h-full max-w-4xl rounded-2xl bg-slate-50 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 rounded-t-2xl border-b border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-2"><Search className="h-5 w-5 text-orange-700" /><h2 className="text-xl font-bold">Research profile</h2></div>
            <p className="mt-1 text-sm text-slate-600">Find public information, review the evidence, then choose what gets added.</p>
          </div>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" type="button" onClick={onClose} aria-label="Close research"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid gap-4 p-4 sm:p-5">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-semibold">Research depth</p>
                <p className="mt-1 text-sm text-slate-600">Quick checks the current profile. Deep investigates the event more fully and scouts useful event calendars/directories it finds.</p>
              </div>
              <div className="flex gap-2">
                {(["quick", "deep"] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-lg border px-3 py-2 text-sm font-semibold capitalize ${mode === value ? "border-orange-300 bg-orange-50 text-orange-800" : "border-slate-200 bg-white text-slate-700"}`}>{value}</button>)}
                <button className="button-primary" type="button" disabled={busy} onClick={() => void startResearch()}>{busy && !run ? "Researching…" : run ? "Research again" : "Start research"}</button>
              </div>
            </div>
          </section>

          {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}
          {applyMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{applyMessage}</p> : null}

          {run?.status === "failed" ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-900">Research could not finish</h3><p className="mt-1 text-sm text-amber-800">{run.failureMessage ?? "The public research provider was unavailable."}</p><button className="mt-3 button-secondary" type="button" disabled={busy} onClick={() => void startResearch()}>Try again</button></section> : null}

          {run?.status === "complete" ? (
            <>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-bold">Research summary</h3><p className="mt-1 text-sm text-slate-600">{run.mode === "deep" ? "Deep research" : "Quick research"} · {run.suggestions.length} profile update{run.suggestions.length === 1 ? "" : "s"} · {findings.length} key finding{findings.length === 1 ? "" : "s"}{run.mode === "deep" ? ` · ${relatedEvents.length} related event${relatedEvents.length === 1 ? "" : "s"}` : ""}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button className="button-secondary" type="button" disabled={busy || !pending.some((item) => item.confidence === "high" && !item.conflict)} onClick={() => void applyHighConfidence()}>Add all high-confidence</button>
                    <button className="button-primary" type="button" disabled={busy || !selected.size} onClick={() => void applySelected()}>Add selected ({selected.size})</button>
                  </div>
                </div>
                {run.summary?.identity?.rationale ? <p className="mt-3 text-sm text-slate-700"><strong>Identity match:</strong> {run.summary.identity.rationale}</p> : null}
                {run.summary?.deepSummary ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><p className="font-semibold">Booking research brief</p><p className="mt-1 whitespace-pre-wrap">{run.summary.deepSummary}</p></div> : null}
              </section>

              {findings.length ? (
                <section className="grid gap-3">
                  <div><h3 className="text-lg font-bold">Key findings</h3><p className="text-sm text-slate-600">Useful researched information that may not belong in a single editable profile field.</p></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {findings.map((finding, index) => {
                      const sources = finding.sourceUrls.flatMap((url) => { const source = sourceByUrl.get(url); return source ? [source] : []; });
                      return <article className="rounded-xl border border-slate-200 bg-white p-4" key={`${finding.label}-${index}`}><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{finding.label}</p><p className="mt-1 font-semibold text-slate-950">{finding.value}</p><p className="mt-2 text-sm text-slate-600">{finding.rationale}</p>{sources.length ? <div className="mt-3 flex flex-wrap gap-2">{sources.map((source) => source.url ? <a key={source.id} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline" href={source.url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" />{source.title}</a> : null)}</div> : null}</article>;
                    })}
                  </div>
                </section>
              ) : null}

              <section className="grid gap-3">
                <div><h3 className="text-lg font-bold">Suggested profile updates</h3><p className="text-sm text-slate-600">Nothing changes until you approve it.</p></div>
                {run.suggestions.length ? run.suggestions.map((suggestion) => {
                  const sources = suggestion.sourceIds.flatMap((id) => { const source = sourceById.get(id); return source ? [source] : []; });
                  const pendingSuggestion = suggestion.reviewStatus === "pending";
                  return (
                    <article key={suggestion.id} className={`rounded-xl border bg-white p-4 ${suggestion.conflict ? "border-amber-300" : "border-slate-200"}`}>
                      <div className="flex items-start gap-3">
                        {pendingSuggestion ? <input className="mt-1 h-4 w-4" type="checkbox" aria-label={`Select ${labelField(suggestion.field)}`} checked={selected.has(suggestion.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(suggestion.id); else next.delete(suggestion.id); return next; })} /> : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><h4 className="font-bold">{labelField(suggestion.field)}</h4><span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${confidenceClass(suggestion.confidence)}`}>{suggestion.confidence}</span>{suggestion.conflict ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Changes existing value</span> : null}{suggestion.reviewStatus !== "pending" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-600">{suggestion.reviewStatus}</span> : null}</div>
                          <div className="mt-2 grid gap-1 text-sm"><p className="text-slate-500">Current: <span className="text-slate-700">{suggestion.currentValue || "Not set"}</span></p><p className="font-semibold text-slate-950">Found: {suggestion.suggestedValue}</p></div>
                          <p className="mt-2 text-sm text-slate-600">{suggestion.rationale}</p>
                          {sources.length ? <div className="mt-3 flex flex-wrap gap-2">{sources.map((source) => source.url ? <a key={source.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-orange-300" href={source.url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" />{source.title}</a> : null)}</div> : null}
                        </div>
                        {pendingSuggestion ? <button className="text-sm font-semibold text-slate-500 hover:text-rose-700" type="button" disabled={busy} onClick={() => void dismiss(suggestion.id)}>Dismiss</button> : null}
                      </div>
                    </article>
                  );
                }) : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">No evidence-backed profile field changes were found. The key findings above may still contain useful booking information.</p>}
              </section>

              {run.mode === "deep" ? (
                <section className="grid gap-3">
                  <div><h3 className="text-lg font-bold">Other event opportunities found</h3><p className="text-sm text-slate-600">Deep Research checks broader calendars/directories it encounters and compares discoveries with Command Center.</p></div>
                  {relatedEvents.length ? <div className="grid gap-3">{relatedEvents.map((event, index) => {
                    const match = crmMatchLabel(event.crmMatch);
                    const crmHref = event.crmMatch?.status === "existing" || event.crmMatch?.status === "possible_match"
                      ? event.crmMatch.bookingId ? `/bookings/${event.crmMatch.bookingId}` : `/profiles/${event.crmMatch.organizationId}`
                      : `/profiles?q=${encodeURIComponent(event.name)}`;
                    return <article className="rounded-xl border border-slate-200 bg-white p-4" key={`${event.name}-${event.startsAt ?? index}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-bold text-slate-950">{event.name}</h4><p className="mt-1 text-sm text-slate-600">{[event.venue, [event.city, event.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "Location not confirmed"}</p><p className="mt-1 text-sm font-semibold text-slate-700">{eventDateLabel(event)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${match.className}`}>{match.label}</span></div><p className="mt-2 text-sm text-slate-600">{event.rationale}</p>{event.crmMatch?.status === "possible_match" ? <p className="mt-2 text-xs font-semibold text-amber-800">Possible CRM match: {event.crmMatch.matchedName}</p> : null}<div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-orange-300" href={event.url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" />Open source</a><Link className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-orange-300" href={crmHref}>{event.crmMatch?.status === "existing" ? "Open in Command Center" : event.crmMatch?.status === "possible_match" ? "Review possible match" : "Check profiles"}</Link></div></article>;
                  })}</div> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">No additional prospect-worthy events were confidently found on the sources researched this time.</p>}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
