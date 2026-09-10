import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";

import { geocodeAddressAction, type GeocodeCandidate } from "@/actions/trips";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { eventProfileHref } from "@/components/today/next-call-card";
import { saveTodayReturnContext } from "@/features/today/today-return-context";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";
import {
  addCandidate,
  admitProfile,
  advanceCandidate,
  assignOfficeIdentity,
  bindOpportunity,
  checkCandidate,
  createHold,
  createOpening,
  changeCommitment,
  extendHold,
  getAllocations,
  getDispatches,
  getPlanner,
  getRecoveryCatalog,
  linkAttempt,
  patchCandidate,
  releaseHold,
  requestResearch,
  reconcileDispatch,
  reviewImportedSource,
  reviewDraftContent,
  reviewHistory,
  reviewInbound,
  reviewSource,
  saveCandidateDemand,
  saveCommittedDemand,
  saveRouteAnchor,
  saveResearchResults,
  searchOpportunities,
  searchProfiles,
  setOpeningStatus,
  approveDraft,
  revokeRouteAnchor,
  type AllocationCatalog,
  type Candidate,
  type DraftContent,
  type DraftKind,
  type DraftReviewResult,
  type Dispatch,
  type Opening,
  type OpportunityChoice,
  type OutreachStage,
  type OutreachTier,
  type Planner,
  type ProfileChoice,
  type RecoveryCatalog,
  type ResearchTask,
} from "@/features/outreach-planner/outreach-api";

const panel = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
const input = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal";
const tiers: OutreachTier[] = ["dedicated", "convention", "strong", "filler", "unclassified"];
const stages: OutreachStage[] = ["initial", "follow_up_1", "follow_up_2"];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function date(value: string | null | undefined) {
  if (!value) return "Unknown — review";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: dateOnly ? "UTC" : BUSINESS_TIME_ZONE }).format(new Date(dateOnly ? `${value}T12:00:00Z` : value));
}
function instant(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TIME_ZONE }).format(new Date(value)) : "Not set";
}
function toIso(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}
function deviceZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "your device timezone";
}
function localInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function packageText(opening: Opening, planner: Planner) {
  return Object.entries(opening.quantities).map(([code, quantity]) => `${planner.packages.find((item) => item.code === code)?.name ?? code}: ${quantity}`).join(" · ");
}
function ErrorMessage({ value }: { value: string }) {
  return value ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{value}</p> : null;
}
function Details({ children, title }: { children: ReactNode; title: string }) {
  return <details className="rounded-lg border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">{title}</summary><div className="mt-3 grid gap-3">{children}</div></details>;
}

function OpeningSetup({ planner, reload }: { planner: Planner; reload(): Promise<void> }) {
  const nowYear = new Date().getFullYear();
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(nowYear);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [legId, setLegId] = useState(planner.legs.find((item) => item.active)?.id ?? "");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const legs = planner.legs.filter((item) => item.active);
  const packages = planner.packages.filter((item) => item.active);
  const missing = !legs.length || !packages.length;
  async function submit() {
    const selected = Object.fromEntries(Object.entries(quantities).filter(([, value]) => value > 0));
    if (!title.trim() || !startsOn || !endsOn || !legId || !Object.keys(selected).length) {
      setError("Name the opening, choose its real dates and active leg, and request at least one configured package."); return;
    }
    setBusy(true); setError("");
    try {
      await createOpening({ title: title.trim(), eventYear: year, startsOn, endsOn, legId: legId, quantities: selected });
      setTitle(""); setStartsOn(""); setEndsOn(""); setQuantities({}); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the opening."); }
    finally { setBusy(false); }
  }
  return <section className={panel} aria-labelledby="opening-setup-title">
    <h3 className="font-bold" id="opening-setup-title">Create a route opening</h3>
    <p className="mt-1 text-sm text-slate-600">Use real operational dates, an active leg, and configured package counts.</p>
    {missing ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">Set up at least one active travel leg and one active package before creating an opening.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Opening name<input className={input} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">Event year<input className={input} type="number" min="2000" max="2200" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
      <label className="grid gap-1 text-sm font-semibold">Active travel leg<select className={input} value={legId} onChange={(event) => setLegId(event.target.value)}><option value="">Choose a leg</option>{legs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">Opening starts<input className={input} type="date" value={startsOn} onChange={(event) => { setStartsOn(event.target.value); if (event.target.value) setYear(Number(event.target.value.slice(0, 4))); }} /></label>
      <label className="grid gap-1 text-sm font-semibold">Opening ends<input className={input} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label>
      <fieldset className="grid gap-2 sm:col-span-2"><legend className="text-sm font-semibold">Requested package quantities</legend><div className="grid gap-2 sm:grid-cols-2">{packages.map((item) => <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 text-sm" key={item.id}><span>{item.name} <span className="text-slate-500">({item.normalCapacity - item.temporaryUnavailableQuantity} configured usable)</span></span><input aria-label={`${item.name} quantity`} className="w-20 rounded border px-2 py-1" min="0" type="number" value={quantities[item.code] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [item.code]: Number(event.target.value) }))} /></label>)}</div></fieldset>
      <div className="sm:col-span-2"><ErrorMessage value={error} /><button className="button-primary mt-2 min-h-11" disabled={busy} type="button" onClick={() => void submit()}>{busy ? "Creating…" : "Create opening"}</button></div>
    </div>}
  </section>;
}

function CandidatePicker({ opening, reload }: { opening: Opening; reload(): Promise<void> }) {
  const [mode, setMode] = useState<"opportunity" | "profile">("opportunity");
  const [query, setQuery] = useState("");
  const [opportunities, setOpportunities] = useState<OpportunityChoice[]>([]);
  const [profiles, setProfiles] = useState<ProfileChoice[]>([]);
  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityChoice | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ProfileChoice | null>(null);
  const [bookingId, setBookingId] = useState("");
  const [tier, setTier] = useState<OutreachTier>("unclassified");
  const [rank, setRank] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search() {
    setBusy(true); setError(""); setSelectedOpportunity(null); setSelectedProfile(null);
    try {
      if (mode === "opportunity") setOpportunities(await searchOpportunities(query, opening.eventYear));
      else setProfiles(await searchProfiles(query, opening.eventYear));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Search failed."); }
    finally { setBusy(false); }
  }
  function suggestions(items: Candidate["suggestions"]) {
    return items.length ? <p className="mt-1 text-xs text-slate-600">Profile suggestion: {items.map((item) => `${label(item.tier)} — ${item.reason}${item.conventionYear ? ` (${item.conventionYear} convention)` : ""}`).join("; ")}. Choose the tier for this event year.</p> : null;
  }
  async function submit() {
    if (!reason.trim()) { setError("Record why this profile and event year belong in the opening."); return; }
    setBusy(true); setError("");
    try {
      let opportunityId = selectedOpportunity?.id;
      if (selectedOpportunity && !selectedOpportunity.bookingId && bookingId) {
        await bindOpportunity(selectedOpportunity.id, { bookingId, confirmedEventYear: opening.eventYear, reason: reason.trim() });
      }
      if (!opportunityId && selectedProfile) {
        opportunityId = (await admitProfile({ organizationId: selectedProfile.organizationId, eventYear: opening.eventYear, bookingId: bookingId || null, reason: reason.trim() })).opportunityId;
      }
      if (!opportunityId) throw new Error("Choose an existing opportunity or profile.");
      await addCandidate({ openingId: opening.id, opportunityId, tier, manualRank: rank, reason: tier === "convention" || mode === "profile" ? reason.trim() : undefined });
      setQuery(""); setOpportunities([]); setProfiles([]); setSelectedOpportunity(null); setSelectedProfile(null); setReason(""); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add the candidate."); }
    finally { setBusy(false); }
  }
  return <Details title="Add an existing opportunity or saved Scout profile">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Candidate source"><button className={mode === "opportunity" ? "button-primary" : "button-secondary"} type="button" onClick={() => setMode("opportunity")}>Existing opportunity</button><button className={mode === "profile" ? "button-primary" : "button-secondary"} type="button" onClick={() => setMode("profile")}>Saved profile</button></div>
    <div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 text-sm font-semibold">Search by name<input className={`${input} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button-secondary min-h-11 self-end" disabled={busy} type="button" onClick={() => void search()}>Search</button></div>
    {mode === "opportunity" && opportunities.length ? <div className="grid gap-2">{opportunities.map((item) => <button className={`min-h-11 rounded-lg border p-3 text-left ${selectedOpportunity?.id === item.id ? "border-pink-500 bg-pink-50" : "border-slate-200"}`} key={item.id} type="button" onClick={() => { setSelectedOpportunity(item); setTier(item.suggestions[0]?.tier ?? "unclassified"); setBookingId(""); }}><strong>{item.organizationName}</strong><span className="block text-sm text-slate-600">{item.eventYear} · {label(item.status)}{item.bookingId ? " · linked event" : " · dates need review"}</span>{suggestions(item.suggestions)}</button>)}</div> : null}
    {mode === "profile" && profiles.length ? <div className="grid gap-2">{profiles.map((item) => <button className={`min-h-11 rounded-lg border p-3 text-left ${selectedProfile?.organizationId === item.organizationId ? "border-pink-500 bg-pink-50" : "border-slate-200"}`} key={item.organizationId} type="button" onClick={() => { setSelectedProfile(item); setTier(item.suggestions[0]?.tier ?? "unclassified"); setBookingId(""); }}><strong>{item.organizationName}</strong><span className="block text-sm text-slate-600">{[item.city, item.region].filter(Boolean).join(", ") || "Location needs review"}</span>{item.protectedReason ? <span className="block text-sm font-semibold text-rose-700">Protected: {item.protectedReason}</span> : null}{suggestions(item.suggestions)}</button>)}</div> : null}
    {selectedProfile?.bookings.length ? <label className="grid gap-1 text-sm font-semibold">Matching event booking (optional; identity must match)<select className={input} value={bookingId} onChange={(event) => setBookingId(event.target.value)}><option value="">No verified matching booking yet</option>{selectedProfile.bookings.map((item) => <option value={item.id} key={item.id}>{item.name} · {date(item.startsAt)}</option>)}</select></label> : null}
    {selectedOpportunity && !selectedOpportunity.bookingId && selectedOpportunity.bookings?.length ? <label className="grid gap-1 text-sm font-semibold">Verified matching event<select className={input} value={bookingId} onChange={(event) => setBookingId(event.target.value)}><option value="">Keep event identity in review</option>{selectedOpportunity.bookings.map((item) => <option value={item.id} key={item.id}>{item.name} · {date(item.startsAt)}</option>)}</select><span className="font-normal text-slate-600">Confirming this event preserves the opportunity's drafts, contact history, and next action.</span></label> : null}
    {(selectedOpportunity || selectedProfile) ? <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Tier for {opening.eventYear}<select className={input} value={tier} onChange={(event) => setTier(event.target.value as OutreachTier)}>{tiers.map((item) => <option value={item} key={item}>{label(item)}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Rank<input className={input} type="number" min="0" value={rank} onChange={(event) => setRank(Number(event.target.value))} /></label><label className="grid gap-1 text-sm font-semibold sm:col-span-2">Classification/admission reason<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="sm:col-span-2"><ErrorMessage value={error} /><button className="button-primary mt-2 min-h-11" disabled={busy} type="button" onClick={() => void submit()}>{busy ? "Adding…" : "Add to opening"}</button></div></div> : <ErrorMessage value={error} />}
  </Details>;
}

function CandidateCard({ candidate, opening, planner, allocations, reload }: { candidate: Candidate; opening: Opening; planner: Planner; allocations: AllocationCatalog | null; reload(): Promise<void> }) {
  const [tier, setTier] = useState(candidate.tier);
  const [rank, setRank] = useState(candidate.manualRank);
  const [reason, setReason] = useState("");
  const [decisionDue, setDecisionDue] = useState(localInput(candidate.decisionDueAt));
  const [snoozedUntil, setSnoozedUntil] = useState(localInput(candidate.snoozedUntil));
  const [cadence, setCadence] = useState(candidate.cadenceOverride?.days.join(",") ?? "7,14,21");
  const [minimumGap, setMinimumGap] = useState(candidate.cadenceOverride?.minimumGapDays ?? 7);
  const [cadenceReason, setCadenceReason] = useState(candidate.cadenceOverride?.reason ?? "");
  const [sourceId, setSourceId] = useState("");
  const [sourceReason, setSourceReason] = useState("");
  const [inboundId, setInboundId] = useState("");
  const [inboundClass, setInboundClass] = useState<"meaningful_reply" | "conversation" | "not_reply">("meaningful_reply");
  const [inboundReference, setInboundReference] = useState("");
  const [demand, setDemand] = useState<Record<string, number>>(() => Object.fromEntries(planner.packages.map((item) => [item.code, opening.quantities[item.code] ?? 0])));
  const [resources, setResources] = useState<string[]>([]);
  const [holdExpiry, setHoldExpiry] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const activeHold = allocations?.holds.find((item) => item.id === candidate.liveHoldId || (item.candidate_id === candidate.id && item.state === "active")) ?? null;
  const openingLeg = planner.legs.find((item) => item.id === opening.legId)?.name ?? "Leg needs review";
  const profileHref = eventProfileHref({ organizationId: candidate.organizationId, bookingId: candidate.bookingId }) ?? `/profiles/${candidate.organizationId}`;
  const href = `${profileHref}${profileHref.includes("?") ? "&" : "?"}from=today&workItemId=outreach-${candidate.id}`;
  const advanceReasons = [
    candidate.outreach.state !== "advance" ? candidate.outreach.reason : "",
    candidate.portfolio.state !== "first_choice" ? candidate.portfolio.reason : "",
    candidate.liveHoldId ? "Release or resolve the live hold first." : "",
    candidate.sources.reviewReasons.length ? "Resolve source review first." : "",
    candidate.sources.manualNextActions.length ? "An existing callback remains visible and must be handled first." : "",
  ].filter(Boolean);
  async function mutate(name: string, action: () => Promise<unknown>) {
    setBusy(name); setError("");
    try { await action(); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the change."); }
    finally { setBusy(""); }
  }
  async function editPriority() {
    if (!reason.trim()) { setError("Explain this classification or rank change."); return; }
    await mutate("priority", () => patchCandidate(candidate.id, { tier, manualRank: rank, reason: reason.trim() }));
  }
  async function saveTiming(kind: "decision" | "snooze") {
    if (!reason.trim()) { setError("Record why this timing is changing."); return; }
    const raw = kind === "decision" ? decisionDue : snoozedUntil;
    const iso = raw ? toIso(raw) : null;
    if (raw && !iso) { setError("Choose a valid date and time."); return; }
    await mutate(kind, () => patchCandidate(candidate.id, { [kind === "decision" ? "decisionDueAt" : "snoozedUntil"]: iso, reason: reason.trim() }));
  }
  async function saveCadence() {
    const days = cadence.split(",").map((item) => Number(item.trim()));
    if (days.length !== 3 || days.some((day) => !Number.isInteger(day)) || !cadenceReason.trim() || !reason.trim()) { setError("Enter three increasing whole-day offsets, the override reason, and the audit reason."); return; }
    await mutate("cadence", () => patchCandidate(candidate.id, { cadenceOverride: { days, minimumGapDays: minimumGap, reason: cadenceReason.trim() }, reason: reason.trim() }));
  }
  async function saveDemand() {
    const quantities = Object.fromEntries(Object.entries(demand).filter(([, quantity]) => quantity > 0));
    if (!Object.keys(quantities).length || !resources.length || !reason.trim()) { setError("Select positive package quantities, every required physical resource, and a review reason."); return; }
    await mutate("demand", () => saveCandidateDemand(candidate.id, { quantities, resourceIds: resources, completePhysicalDemandReviewed: true, reason: reason.trim() }));
  }
  const capacityClass = candidate.capacity.status === "fits" ? "bg-emerald-50 text-emerald-800" : candidate.capacity.status === "does_not_fit" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900";
  return <article className="min-w-0 rounded-xl border border-pink-100 bg-white p-4 shadow-sm" data-work-item-id={`outreach-${candidate.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><Link className="break-words text-lg font-bold text-slate-950 hover:text-pink-700" href={href} onClick={() => saveTodayReturnContext({ filter: "outreach", workItemId: `outreach-${candidate.id}`, scrollY: window.scrollY })}>{candidate.organizationName}</Link><p className="mt-1 text-sm text-slate-600">{candidate.eventYear} · {label(candidate.tier)} · rank {candidate.manualRank}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${capacityClass}`}>{candidate.capacity.status === "fits" ? "Verified fit" : label(candidate.capacity.status)}</span></div>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold text-slate-500">Actual event dates</dt><dd>{date(candidate.eventStartsAt)}{candidate.eventEndsAt ? ` – ${date(candidate.eventEndsAt)}` : ""}</dd></div>
      <div><dt className="font-semibold text-slate-500">Opening dates</dt><dd>{date(opening.startsOn)} – {date(opening.endsOn)}</dd></div>
      <div><dt className="font-semibold text-slate-500">Leg and packages</dt><dd>{openingLeg} · {packageText(opening, planner)}</dd></div>
      <div><dt className="font-semibold text-slate-500">Next action</dt><dd>{candidate.outreach.reason}{candidate.outreach.dueAt ? ` · ${instant(candidate.outreach.dueAt)}` : ""}</dd></div>
      <div><dt className="font-semibold text-slate-500">Contact evidence</dt><dd>{candidate.sources.choices.length ? `${candidate.sources.choices.length} actual source${candidate.sources.choices.length === 1 ? "" : "s"}; ${candidate.attempts.length} linked` : "No successful send or completed call evidence"}</dd></div>
      <div><dt className="font-semibold text-slate-500">Portfolio priority</dt><dd>{candidate.portfolio.reason}</dd></div>
    </dl>
    {candidate.waitingFor ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><strong>Waiting for {candidate.waitingFor.organizationName}:</strong> {candidate.waitingFor.reason}</p> : null}
    {candidate.portfolio.competing.length ? <p className="mt-2 text-sm text-slate-600">Competes with {candidate.portfolio.competing.map((item) => `${item.organizationName} for ${item.openingTitle}`).join(", ")}.</p> : null}
    <ErrorMessage value={error} />
    <div className="mt-3 grid gap-2">
      <Details title="Decision, snooze, classification and rank">
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Tier for this event year<select className={input} value={tier} onChange={(event) => setTier(event.target.value as OutreachTier)}>{tiers.map((item) => <option key={item}>{item}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Rank<input className={input} min="0" type="number" value={rank} onChange={(event) => setRank(Number(event.target.value))} /></label></div>
        {candidate.suggestions.length ? <p className="text-sm text-slate-600">Profile context: {candidate.suggestions.map((item) => `${label(item.tier)} — ${item.reason}${item.conventionYear ? `; convention ${item.conventionYear}` : ""}`).join(" · ")}</p> : null}
        <label className="grid gap-1 text-sm font-semibold">Audit reason<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="button-secondary min-h-11 w-fit" disabled={!!busy} type="button" onClick={() => void editPriority()}>{busy === "priority" ? "Saving…" : "Save classification and rank"}</button>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Decision due ({deviceZone()})<input className={input} type="datetime-local" value={decisionDue} onChange={(event) => setDecisionDue(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Snooze routine outreach until ({deviceZone()})<input className={input} type="datetime-local" value={snoozedUntil} onChange={(event) => setSnoozedUntil(event.target.value)} /></label></div>
        <div className="flex flex-wrap gap-2"><button className="button-secondary min-h-11" disabled={!!busy} type="button" onClick={() => void saveTiming("decision")}>Save decision date</button><button className="button-secondary min-h-11" disabled={!!busy} type="button" onClick={() => void saveTiming("snooze")}>Save snooze</button></div>
        <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-sm font-semibold">Cadence days<input className={input} value={cadence} onChange={(event) => setCadence(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Minimum gap days<input className={input} min="1" type="number" value={minimumGap} onChange={(event) => setMinimumGap(Number(event.target.value))} /></label><label className="grid gap-1 text-sm font-semibold">Cadence override reason<input className={input} value={cadenceReason} onChange={(event) => setCadenceReason(event.target.value)} /></label></div>
        <p className="text-xs text-slate-500">Default is 7 / 14 / 21 days. A shorter cadence cannot bypass missing evidence, replies, decisions, or callbacks.</p><button className="button-secondary min-h-11 w-fit" disabled={!!busy} type="button" onClick={() => void saveCadence()}>Save cadence override</button>
      </Details>
      <Details title="Actual contact history and source review">
        <button className="button-secondary min-h-11 w-fit" disabled={!!busy} type="button" onClick={() => void mutate("check", () => checkCandidate(candidate.id))}>{busy === "check" ? "Checking…" : "Refresh actual sources and allocation"}</button>
        {candidate.sources.reviewReasons.map((item) => <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" key={item}>{item}</p>)}
        <label className="grid gap-1 text-sm font-semibold">Successful send or completed call<select className={input} value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose actual evidence</option>{candidate.sources.choices.map((choice) => <option key={choice.id} value={choice.id}>{label(choice.kind)} · {instant(choice.occurredAt)} · {choice.reason}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">What you checked<textarea className={input} value={sourceReason} onChange={(event) => setSourceReason(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button className="button-secondary min-h-11" disabled={!!busy || !sourceId || !candidate.outreach.nextStage} type="button" onClick={() => void mutate("attempt", () => linkAttempt(candidate.id, { sourceId, stage: candidate.outreach.nextStage!, confirmedEventYear: candidate.eventYear, reason: sourceReason || undefined }))}>Link as {candidate.outreach.nextStage ? label(candidate.outreach.nextStage) : "next stage"}</button><button className="button-secondary min-h-11" disabled={!!busy || !sourceId || !sourceReason.trim()} type="button" onClick={() => void mutate("source", () => reviewSource(candidate.id, { sourceId, classification: "not_cadence", confirmedEventYear: candidate.eventYear, reason: sourceReason.trim() }))}>Reviewed, not cadence</button><button className="button-secondary min-h-11" disabled={!!busy || !sourceReason.trim() || candidate.sources.historyFingerprint === "unverified"} type="button" onClick={() => void mutate("history", () => reviewHistory(candidate.id, sourceReason.trim()))}>Save history review</button></div>
        {(candidate.sources.inboundObservations ?? []).some((item) => item.state !== "reviewed") ? <div className="grid gap-3 rounded-lg border border-amber-200 p-3"><h4 className="font-semibold">Review observed inbound message</h4><label className="grid gap-1 text-sm font-semibold">Message<select className={input} value={inboundId} onChange={(event) => setInboundId(event.target.value)}><option value="">Choose a message/thread</option>{candidate.sources.inboundObservations!.filter((item) => item.state !== "reviewed").map((item) => <option value={item.id} key={item.id}>{item.messageId} · {item.receivedAt ? instant(item.receivedAt) : "received time needs review"}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Classification<select className={input} value={inboundClass} onChange={(event) => setInboundClass(event.target.value as typeof inboundClass)}><option value="meaningful_reply">Meaningful reply</option><option value="conversation">Conversation</option><option value="not_reply">Not a reply</option></select></label><label className="grid gap-1 text-sm font-semibold">Source reference<input className={input} value={inboundReference} onChange={(event) => setInboundReference(event.target.value)} /></label><button className="button-secondary min-h-11 w-fit" disabled={!!busy || !inboundId || !inboundReference.trim() || !sourceReason.trim()} type="button" onClick={() => void mutate("inbound", () => reviewInbound(inboundId, { classification: inboundClass, opportunityId: inboundClass === "not_reply" ? null : candidate.opportunityId, reason: sourceReason.trim(), sourceReference: inboundReference.trim() }))}>Save inbound review</button></div> : null}
      </Details>
      <Details title="Demand, hold and allocation audit">
        <p className="text-sm text-slate-600">A fit label reflects the latest verified check only. It is not a promise unless there is a current live allocation.</p>
        {candidate.capacityDisplayReasons.map((item) => <p className={`rounded-lg p-2 text-sm ${capacityClass}`} key={item}>{item}</p>)}
        <fieldset><legend className="text-sm font-semibold">Exact package demand</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{planner.packages.filter((item) => item.active).map((item) => <label className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm" key={item.id}>{item.name}<input aria-label={`${candidate.organizationName} ${item.name} demand`} className="w-20 rounded border px-2 py-1" min="0" type="number" value={demand[item.code] ?? 0} onChange={(event) => setDemand((current) => ({ ...current, [item.code]: Number(event.target.value) }))} /></label>)}</div></fieldset>
        <fieldset><legend className="text-sm font-semibold">Required physical resources</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{allocations?.resources.map((item) => <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm" key={item.id}><input type="checkbox" checked={resources.includes(item.id)} onChange={(event) => setResources((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name} · {label(item.status)}</label>) ?? <p className="text-sm text-amber-800">Resource catalog needs review.</p>}</div></fieldset>
        <button className="button-secondary min-h-11 w-fit" disabled={!!busy} type="button" onClick={() => void saveDemand()}>Save reviewed exact demand</button>
        {activeHold ? <div className="rounded-lg bg-pink-50 p-3 text-sm"><p><strong>Live hold:</strong> expires {instant(activeHold.expires_at)}</p><p>{Object.entries(activeHold.quantities).map(([code, quantity]) => `${planner.packages.find((item) => item.code === code)?.name ?? code}: ${quantity}`).join(" · ")}</p><div className="mt-2 flex flex-wrap gap-2"><button className="button-secondary min-h-11" disabled={!!busy} type="button" onClick={() => void mutate("release", () => releaseHold(activeHold.id))}>Release hold</button><label className="grid gap-1 font-semibold">New expiry ({deviceZone()})<input className={input} type="datetime-local" value={holdExpiry} onChange={(event) => setHoldExpiry(event.target.value)} /></label><button className="button-secondary min-h-11 self-end" disabled={!!busy || !toIso(holdExpiry)} type="button" onClick={() => void mutate("extend", () => extendHold(activeHold.id, toIso(holdExpiry)))}>Extend hold</button></div></div> : <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><label className="grid gap-1 text-sm font-semibold">Hold expiry ({deviceZone()})<input className={input} type="datetime-local" value={holdExpiry} onChange={(event) => setHoldExpiry(event.target.value)} /></label><button className="button-secondary min-h-11" disabled={!!busy || candidate.capacity.status !== "fits" || !toIso(holdExpiry)} type="button" title={candidate.capacity.status !== "fits" ? "Run a fresh check and resolve review or conflicts first." : undefined} onClick={() => void mutate("hold", () => createHold(candidate.id, toIso(holdExpiry)))}>Create verified hold</button></div>}
      </Details>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button className="button-secondary min-h-11" disabled={!!busy || advanceReasons.length > 0} title={advanceReasons.join(" ") || undefined} type="button" onClick={() => void mutate("advance", () => advanceCandidate(candidate.id))}>Advance to next candidate</button>{advanceReasons.length ? <span className="text-sm text-slate-600">{advanceReasons[0]}</span> : null}</div>
  </article>;
}

function ResearchForm({ opening, planner, onCreated }: { opening: Opening; planner: Planner; onCreated(): Promise<void> }) {
  const { openAssistant } = useAssistantContext();
  const [criteria, setCriteria] = useState("");
  const [anchor, setAnchor] = useState("");
  const [results, setResults] = useState<GeocodeCandidate[]>([]);
  const [selected, setSelected] = useState<GeocodeCandidate | null>(null);
  const [radius, setRadius] = useState(100);
  const [regions, setRegions] = useState("");
  const [targetCount, setTargetCount] = useState(3);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function geocode() {
    setBusy("geocode"); setError(""); setSelected(null);
    const response = await geocodeAddressAction(anchor);
    if (response.ok) setResults(response.results);
    else setError(response.error);
    setBusy("");
  }
  async function save() {
    if (!criteria.trim() || !selected) { setError("Describe the lead criteria and select the exact search location."); return; }
    setBusy("save"); setError("");
    try {
      await requestResearch(opening.id, { criteria: criteria.trim(), qualificationCriteria: { startsOn: opening.startsOn, endsOn: opening.endsOn, quantities: opening.quantities, geography: { latitude: selected.latitude, longitude: selected.longitude, radiusMiles: radius, adjacentRegions: regions.split(",").map((item) => item.trim()).filter(Boolean) } }, targetCount });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save research criteria."); }
    finally { setBusy(""); }
  }
  function launchScout() {
    openAssistant(`Scout events around ${selected?.displayName ?? anchor} from ${opening.startsOn} through ${opening.endsOn}. Use the saved criteria “${criteria}” and review results before adding a profile.`);
  }
  return <Details title={`Find leads for ${opening.title}`}>
    <p className="text-sm text-slate-600">Saving criteria creates a review task. It does not start web research or add business data.</p>
    <label className="grid gap-1 text-sm font-semibold">What qualifies<textarea className={input} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></label>
    <div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 text-sm font-semibold">Search location or address<input className={`${input} mt-1`} value={anchor} onChange={(event) => { setAnchor(event.target.value); setSelected(null); }} /></label><button className="button-secondary min-h-11 self-end" disabled={busy === "geocode" || !anchor.trim()} type="button" onClick={() => void geocode()}>{busy === "geocode" ? "Looking…" : "Find location"}</button></div>
    {results.length ? <fieldset><legend className="text-sm font-semibold">Choose the actual location</legend><div className="mt-2 grid gap-2">{results.map((item) => <label className="flex min-h-11 items-center gap-2 rounded-lg border p-2 text-sm" key={`${item.latitude}:${item.longitude}`}><input type="radio" name={`research-location-${opening.id}`} checked={selected?.latitude === item.latitude && selected?.longitude === item.longitude} onChange={() => setSelected(item)} />{item.displayName}</label>)}</div></fieldset> : null}
    <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-sm font-semibold">Radius miles<input className={input} type="number" min="1" max="2000" value={radius} onChange={(event) => setRadius(Number(event.target.value))} /></label><label className="grid gap-1 text-sm font-semibold">Adjacent regions<input className={input} placeholder="OH, PA" value={regions} onChange={(event) => setRegions(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Backup target<input className={input} type="number" min="1" max="100" value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} /></label></div>
    <p className="text-sm"><strong>Dates:</strong> {date(opening.startsOn)} – {date(opening.endsOn)} · <strong>Packages:</strong> {packageText(opening, planner)}</p>
    <ErrorMessage value={error} /><div className="flex flex-wrap gap-2"><button className="button-primary min-h-11" disabled={!!busy} type="button" onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save research task"}</button><button className="button-secondary min-h-11" disabled={!selected || !criteria.trim()} type="button" onClick={launchScout}>Open Lead Scout with these facts</button></div>
  </Details>;
}

function ResearchResultForm({ task, opening, planner, reload }: { task: ResearchTask; opening: Opening; planner: Planner; reload(): Promise<void> }) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<OpportunityChoice[]>([]);
  const [choice, setChoice] = useState<OpportunityChoice | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [note, setNote] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [contact, setContact] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [region, setRegion] = useState("");
  const [verified, setVerified] = useState({ dates: false, contact: false, fit: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search() { setBusy(true); setError(""); try { setChoices(await searchOpportunities(query, opening.eventYear)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not search opportunities."); } finally { setBusy(false); } }
  async function save() {
    if (!choice || !sourceUrl.trim() || !note.trim() || !toIso(checkedAt)) { setError("Choose an existing event-year opportunity and enter its source URL, checked time, and evidence note."); return; }
    const result: Record<string, unknown> = { opportunityId: choice.id, sourceUrl: sourceUrl.trim(), note: note.trim(), checkedAt: toIso(checkedAt), dateConfidence: verified.dates ? "verified" : "unknown", contactConfidence: verified.contact ? "verified" : "unknown", fitConfidence: verified.fit ? "verified" : "unknown" };
    if (startsOn) result.startsOn = startsOn; if (endsOn) result.endsOn = endsOn; if (contact.trim()) result.contact = contact.trim();
    const packageQuantities = Object.fromEntries(Object.entries(quantities).filter(([, value]) => value > 0)); if (Object.keys(packageQuantities).length) result.quantities = packageQuantities;
    if (latitude && Number.isFinite(Number(latitude))) result.latitude = Number(latitude); if (longitude && Number.isFinite(Number(longitude))) result.longitude = Number(longitude); if (region.trim()) result.region = region.trim();
    setBusy(true); setError(""); try { await saveResearchResults(task.id, [result]); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save research evidence."); } finally { setBusy(false); }
  }
  return <Details title="Add reviewed research evidence"><p className="text-sm text-slate-600">Unknown fields remain review. A result counts only with verified dates, contact, fit, a past checked time, and geography/package facts that satisfy the saved criteria.</p><div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 text-sm font-semibold">Search existing opportunity by name<input className={`${input} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button-secondary min-h-11 self-end" disabled={busy} type="button" onClick={() => void search()}>Search opportunities</button></div>{choices.map((item) => <button className={`min-h-11 rounded-lg border p-3 text-left ${choice?.id === item.id ? "border-pink-500 bg-pink-50" : ""}`} key={item.id} type="button" onClick={() => setChoice(item)}><strong>{item.organizationName}</strong><span className="block text-sm">{item.eventYear} · {item.bookingId ? "linked event" : "event identity needs review"}</span></button>)}{choice ? <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold sm:col-span-2">Source URL<input className={input} type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Checked at ({deviceZone()})<input className={input} type="datetime-local" value={checkedAt} onChange={(event) => setCheckedAt(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Contact evidence<input className={input} value={contact} onChange={(event) => setContact(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Event starts<input className={input} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Event ends<input className={input} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Latitude<input className={input} value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Longitude<input className={input} value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Adjacent region evidence<input className={input} value={region} onChange={(event) => setRegion(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold sm:col-span-2">Evidence note<textarea className={input} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">Package quantities found</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{planner.packages.map((item) => <label className="flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm" key={item.id}>{item.name}<input aria-label={`Research ${item.name} quantity`} className="w-20 rounded border px-2 py-1" min="0" type="number" value={quantities[item.code] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [item.code]: Number(event.target.value) }))} /></label>)}</div></fieldset><fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">Facts independently verified</legend><div className="mt-2 flex flex-wrap gap-3">{([['dates', 'Dates'], ['contact', 'Contact'], ['fit', 'Package / route criteria']] as const).map(([key, text]) => <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm" key={key}><input type="checkbox" checked={verified[key]} onChange={(event) => setVerified((current) => ({ ...current, [key]: event.target.checked }))} />{text}</label>)}</div></fieldset><div className="sm:col-span-2"><ErrorMessage value={error} /><button className="button-secondary mt-2 min-h-11" disabled={busy} type="button" onClick={() => void save()}>Save reviewed result</button></div></div> : <ErrorMessage value={error} />}</Details>;
}

function AllocationReview({ planner, allocations, reload }: { planner: Planner; allocations: AllocationCatalog | null; reload(): Promise<void> }) {
  const [kind, setKind] = useState<"leg" | "resource">("leg");
  const [identity, setIdentity] = useState("");
  const [direction, setDirection] = useState<"departure" | "return">("departure");
  const [location, setLocation] = useState("");
  const [geocodes, setGeocodes] = useState<GeocodeCandidate[]>([]);
  const [selected, setSelected] = useState<GeocodeCandidate | null>(null);
  const [availableAt, setAvailableAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [source, setSource] = useState("");
  const [reason, setReason] = useState("");
  const [claimId, setClaimId] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!allocations) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Allocation details could not load. The rest of Today remains available; retry the planner to review them.</p>;
  const nameFor = (anchor: NonNullable<AllocationCatalog["anchors"]>[number]) => anchor.leg_id ? planner.legs.find((item) => item.id === anchor.leg_id)?.name ?? "Unknown leg" : allocations.resources.find((item) => item.id === anchor.resource_id)?.name ?? "Unknown resource";
  async function locate() {
    setBusy("geocode"); setError(""); setSelected(null); const result = await geocodeAddressAction(location); if (result.ok) setGeocodes(result.results); else setError(result.error); setBusy("");
  }
  async function save() {
    const available = toIso(availableAt), valid = toIso(validUntil);
    if (!identity || !selected || !available || !valid || !source.trim() || !reason.trim()) { setError("Select an identity and location, enter both dated facts, and record their source and reason."); return; }
    setBusy("save"); setError("");
    try { await saveRouteAnchor({ legId: kind === "leg" ? identity : null, resourceId: kind === "resource" ? identity : null, direction, latitude: selected.latitude, longitude: selected.longitude, availableAt: available, validUntil: valid, source: source.trim(), reason: reason.trim() }); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save route anchor."); }
    finally { setBusy(""); }
  }
  return <Details title="Route anchors, physical availability and imported source review">
    <p className="text-sm text-slate-600">Record the actual current location and availability. A geocode proves location only; it does not prove equipment availability.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Anchor identity<select className={input} value={`${kind}:${identity}`} onChange={(event) => { const [nextKind, nextId] = event.target.value.split(":"); setKind(nextKind as "leg" | "resource"); setIdentity(nextId ?? ""); }}><option value="leg:">Choose a leg or resource</option><optgroup label="Travel legs">{planner.legs.filter((item) => item.active).map((item) => <option key={item.id} value={`leg:${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="Physical resources">{allocations.resources.map((item) => <option key={item.id} value={`resource:${item.id}`}>{item.name} · {label(item.status)}</option>)}</optgroup></select></label><label className="grid gap-1 text-sm font-semibold">Direction<select className={input} value={direction} onChange={(event) => setDirection(event.target.value as "departure" | "return")}><option value="departure">Available for departure</option><option value="return">Required return</option></select></label></div>
    <div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 text-sm font-semibold">Address or location<input className={`${input} mt-1`} value={location} onChange={(event) => { setLocation(event.target.value); setSelected(null); }} /></label><button className="button-secondary min-h-11 self-end" disabled={busy === "geocode" || !location.trim()} type="button" onClick={() => void locate()}>Find location</button></div>
    {geocodes.length ? <fieldset><legend className="text-sm font-semibold">Select the exact location</legend>{geocodes.map((item) => <label className="mt-2 flex min-h-11 items-center gap-2 rounded-lg border p-2 text-sm" key={`${item.latitude}:${item.longitude}`}><input type="radio" name="anchor-geocode" checked={selected?.latitude === item.latitude && selected?.longitude === item.longitude} onChange={() => setSelected(item)} />{item.displayName}</label>)}</fieldset> : null}
    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Actual availability / required return ({deviceZone()})<input className={input} type="datetime-local" value={availableAt} onChange={(event) => setAvailableAt(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Evidence valid until ({deviceZone()})<input className={input} type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Evidence source<input className={input} value={source} onChange={(event) => setSource(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Review reason<input className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>
    <ErrorMessage value={error} /><button className="button-secondary min-h-11 w-fit" disabled={!!busy} type="button" onClick={() => void save()}>Save verified anchor facts</button>
    {(allocations.anchors ?? []).length ? <div className="grid gap-2"><h4 className="font-semibold">Recorded anchors</h4>{allocations.anchors!.map((anchor) => <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm" key={anchor.id}><div><strong>{nameFor(anchor)} · {label(anchor.direction)}</strong><p>{instant(anchor.available_at)} · valid through {instant(anchor.valid_until)}</p><p className="text-slate-600">{anchor.source} · {anchor.reason}{anchor.revoked_at ? ` · revoked ${instant(anchor.revoked_at)}` : ""}</p></div>{!anchor.revoked_at ? <button className="button-secondary min-h-11" disabled={!!busy} type="button" onClick={() => { const why = window.prompt("Why is this anchor no longer current?"); if (why?.trim()) void (async () => { setBusy("revoke"); try { await revokeRouteAnchor(anchor.id, why.trim()); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not revoke anchor."); } finally { setBusy(""); } })(); }}>Revoke</button> : null}</div>)}</div> : null}
    {(allocations.reconciliationFacts ?? []).length ? <div><h4 className="font-semibold">Imported commitment review</h4><p className="mt-1 text-sm text-amber-900">Unresolved assistant/import evidence requires independent source review, exact demand review, and then a fresh capacity check. Demand alone cannot confirm its provenance.</p><ul className="mt-2 grid gap-2">{allocations.reconciliationFacts!.map((fact, index) => <li className="rounded-lg border p-3 text-sm" key={String(fact.id ?? index)}><label className="flex min-h-11 items-start gap-2"><input className="mt-1" type="radio" name="reconciliation-fact" checked={claimId === String(fact.id ?? "")} disabled={!fact.id} onChange={() => setClaimId(String(fact.id))} /><span><strong>{String(fact.source ?? fact.state ?? "Imported capacity change")}</strong><span className="block text-slate-600">{String(fact.reason ?? fact.created_at ?? "Review the original source and affected booking before resolving.")}</span></span></label></li>)}</ul>{claimId ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Independent source reference<input className={input} value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">What you independently checked<input className={input} value={claimReason} onChange={(event) => setClaimReason(event.target.value)} /></label><button className="button-secondary min-h-11 w-fit sm:col-span-2" disabled={!!busy || !sourceReference.trim() || !claimReason.trim()} type="button" onClick={() => void (async () => { setBusy("claim"); setError(""); try { await reviewImportedSource(claimId, sourceReference.trim(), claimReason.trim()); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save source review."); } finally { setBusy(""); } })()}>Confirm independently reviewed source</button></div> : null}</div> : null}
  </Details>;
}

function CommittedBookingRecovery({ planner, allocations, reload }: { planner: Planner; allocations: AllocationCatalog | null; reload(): Promise<void> }) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<RecoveryCatalog | null>(null);
  const [bookingId, setBookingId] = useState("");
  const [mode, setMode] = useState<"demand" | "change">("demand");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [legId, setLegId] = useState("");
  const [location, setLocation] = useState("");
  const [locations, setLocations] = useState<GeocodeCandidate[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<GeocodeCandidate | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const booking = catalog?.bookings.find((item) => item.id === bookingId);
  async function search() { setBusy("search"); setError(""); try { setCatalog(await getRecoveryCatalog(query)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not search bookings."); } finally { setBusy(""); } }
  async function locate() { setBusy("geocode"); setError(""); const result = await geocodeAddressAction(location); if (result.ok) setLocations(result.results); else setError(result.error); setBusy(""); }
  async function save() {
    const demand = { quantities: Object.fromEntries(Object.entries(quantities).filter(([, value]) => value > 0)), resourceIds, completePhysicalDemandReviewed: true as const, reason: reason.trim() };
    if (!booking || !Object.keys(demand.quantities).length || !resourceIds.length || !reason.trim()) { setError("Choose a real booking, positive package quantities, every physical resource, and a review reason."); return; }
    if (mode === "change" && (!toIso(startsAt) || !toIso(endsAt) || !legId || !selectedLocation)) { setError("The atomic change needs exact instants, travel leg, and selected event location."); return; }
    setBusy("save"); setError("");
    try {
      if (mode === "demand") await saveCommittedDemand(booking.id, demand);
      else await changeCommitment(booking.id, { startsAt: toIso(startsAt), endsAt: toIso(endsAt), travelLegId: legId, latitude: selectedLocation!.latitude, longitude: selectedLocation!.longitude, demand });
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save committed booking facts."); }
    finally { setBusy(""); }
  }
  return <Details title="Committed booking demand and atomic schedule recovery">
    <p className="text-sm text-slate-600">Use independently known factual schedule and demand. This does not change booking status; a conflicting resulting state remains blocked.</p>
    <div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 text-sm font-semibold">Search bookings or profiles<input className={`${input} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button-secondary min-h-11 self-end" disabled={!!busy} type="button" onClick={() => void search()}>Search</button></div>
    {catalog?.bookings.length ? <label className="grid gap-1 text-sm font-semibold">Existing booking<select className={input} value={bookingId} onChange={(event) => { const selected = catalog.bookings.find((item) => item.id === event.target.value); setBookingId(event.target.value); setStartsAt(localInput(selected?.startsAt)); setEndsAt(localInput(selected?.endsAt)); setLegId(selected?.travelLegId ?? ""); }}><option value="">Choose a booking</option>{catalog.bookings.map((item) => <option value={item.id} key={item.id}>{item.organizationName ? `${item.organizationName} · ` : ""}{item.name} · {label(item.status)} · {date(item.startsAt)}</option>)}</select></label> : null}
    {booking ? <><div className="flex flex-wrap gap-2" role="group" aria-label="Recovery action"><button className={mode === "demand" ? "button-primary" : "button-secondary"} type="button" onClick={() => setMode("demand")}>Record exact committed demand</button><button className={mode === "change" ? "button-primary" : "button-secondary"} type="button" onClick={() => setMode("change")}>Save atomic schedule change</button></div>
      <fieldset><legend className="text-sm font-semibold">Exact package quantities</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{planner.packages.filter((item) => item.active).map((item) => <label className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-sm" key={item.id}>{item.name}<input aria-label={`Committed ${item.name} quantity`} className="w-20 rounded border px-2 py-1" min="0" type="number" value={quantities[item.code] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [item.code]: Number(event.target.value) }))} /></label>)}</div></fieldset>
      <fieldset><legend className="text-sm font-semibold">Every required physical resource</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{allocations?.resources.map((item) => <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm" key={item.id}><input type="checkbox" checked={resourceIds.includes(item.id)} onChange={(event) => setResourceIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>) ?? <p className="text-sm text-amber-900">Resource catalog unavailable.</p>}</div></fieldset>
      {mode === "change" ? <div className="grid gap-3"><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Operational start ({deviceZone()})<input className={input} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Operational end ({deviceZone()})<input className={input} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Travel leg<select className={input} value={legId} onChange={(event) => setLegId(event.target.value)}><option value="">Choose a leg</option>{planner.legs.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 text-sm font-semibold">Actual event location<input className={`${input} mt-1`} value={location} onChange={(event) => { setLocation(event.target.value); setSelectedLocation(null); }} /></label><button className="button-secondary min-h-11 self-end" disabled={!location.trim() || !!busy} type="button" onClick={() => void locate()}>Find location</button></div>{locations.map((item) => <label className="flex min-h-11 items-center gap-2 rounded-lg border p-2 text-sm" key={`${item.latitude}:${item.longitude}`}><input type="radio" name="commitment-location" checked={selectedLocation?.latitude === item.latitude && selectedLocation?.longitude === item.longitude} onChange={() => setSelectedLocation(item)} />{item.displayName}</label>)}</div> : null}
      <label className="grid gap-1 text-sm font-semibold">Factual review reason<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label><ErrorMessage value={error} /><button className="button-secondary min-h-11 w-fit" disabled={!!busy} type="button" onClick={() => void save()}>{busy === "save" ? "Saving…" : mode === "demand" ? "Save reviewed committed demand" : "Save verified atomic change"}</button></> : <ErrorMessage value={error} />}
  </Details>;
}

function groupCandidates(planner: Planner) {
  const active = planner.candidates.filter((item) => !item.releasedAt);
  const attention = active.filter((item) => item.portfolio.state === "attention" || item.portfolio.state === "needs_review" || ["reply", "decision", "advance", "needs_review"].includes(item.outreach.state) || item.capacity.status !== "fits" || item.sources.reviewReasons.length > 0);
  const attentionIds = new Set(attention.map((item) => item.id));
  return {
    contact: active.filter((item) => !attentionIds.has(item.id) && item.portfolio.state === "first_choice" && ["ready", "follow_up"].includes(item.outreach.state)),
    waiting: active.filter((item) => !attentionIds.has(item.id) && (item.portfolio.state === "waiting" || item.outreach.state === "waiting")),
    attention,
  };
}

function DispatchRecovery() {
  const [rows, setRows] = useState<Dispatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [outcome, setOutcome] = useState<"sent" | "not_sent">("not_sent");
  const [sourceReference, setSourceReference] = useState("");
  const [reason, setReason] = useState("");
  const [messageId, setMessageId] = useState("");
  const [sentAt, setSentAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() { setBusy(true); setError(""); try { setRows((await getDispatches()).filter((item) => ["dispatching", "uncertain"].includes(item.state))); setLoaded(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load delivery review."); } finally { setBusy(false); } }
  async function save() {
    if (!selected || !sourceReference.trim() || !reason.trim() || (outcome === "sent" && (!messageId.trim() || !toIso(sentAt)))) { setError("Record the terminated provider operation, source reference, review reason, and sent evidence when applicable."); return; }
    setBusy(true); setError("");
    try { await reconcileDispatch(selected, { outcome, providerOperationTerminated: true, sourceReference: sourceReference.trim(), reason: reason.trim(), ...(outcome === "sent" ? { messageId: messageId.trim(), sentAt: toIso(sentAt) } : {}) }); setSelected(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reconcile the delivery."); }
    finally { setBusy(false); }
  }
  return <Details title="Uncertain delivery reconciliation"><p className="text-sm text-slate-600">An uncertain or in-progress provider outcome cannot be resent. Check the provider first, confirm the operation ended, and record the evidence.</p><button className="button-secondary min-h-11 w-fit" disabled={busy} type="button" onClick={() => void load()}>{busy ? "Loading…" : "Load delivery review"}</button><ErrorMessage value={error} />{loaded && !rows.length ? <p className="text-sm text-slate-600">No unresolved deliveries.</p> : null}{rows.length ? <><label className="grid gap-1 text-sm font-semibold">Delivery<select className={input} value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose an unresolved delivery</option>{rows.map((item) => <option value={item.id} key={item.id}>{label(item.draftKind)} · {label(item.state)} · review after {instant(item.reviewAfter)}</option>)}</select></label>{selected ? <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Verified outcome<select className={input} value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="not_sent">Confirmed not sent</option><option value="sent">Confirmed sent</option></select></label><label className="grid gap-1 text-sm font-semibold">Provider source reference<input className={input} value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></label>{outcome === "sent" ? <><label className="grid gap-1 text-sm font-semibold">Provider message ID<input className={input} value={messageId} onChange={(event) => setMessageId(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Actual sent time ({deviceZone()})<input className={input} type="datetime-local" value={sentAt} onChange={(event) => setSentAt(event.target.value)} /></label></> : null}<label className="grid gap-1 text-sm font-semibold sm:col-span-2">What you checked<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="button-secondary min-h-11 w-fit sm:col-span-2" disabled={busy} type="button" onClick={() => void save()}>Save provider reconciliation</button></div> : null}</> : null}</Details>;
}

export function OutreachPlanner() {
  const [planner, setPlanner] = useState<Planner | null>(null);
  const [allocations, setAllocations] = useState<AllocationCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allocationError, setAllocationError] = useState("");
  async function reload() {
    setError("");
    try {
      const next = await getPlanner(); setPlanner(next);
      if (next.enabled) {
        try { setAllocations(await getAllocations()); setAllocationError(""); }
        catch (cause) { setAllocations(null); setAllocationError(cause instanceof Error ? cause.message : "Allocation details are unavailable."); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load outreach priorities."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  const groups = useMemo(() => planner ? groupCandidates(planner) : { contact: [], waiting: [], attention: [] }, [planner]);
  if (loading) return null;
  if (!planner && error) return <section className={panel} aria-label="Outreach priorities unavailable"><ErrorMessage value={error} /><button className="button-secondary mt-3 min-h-11" type="button" onClick={() => void reload()}>Retry outreach priorities</button></section>;
  if (!planner?.enabled) return null;
  const activeOpenings = planner.openings.filter((item) => item.status === "open");
  const card = (candidate: Candidate) => {
    const opening = planner.openings.find((item) => item.id === candidate.openingId);
    return opening ? <CandidateCard allocations={allocations} candidate={candidate} key={candidate.id} opening={opening} planner={planner} reload={reload} /> : null;
  };
  return <section className="grid min-w-0 gap-4" aria-labelledby="outreach-planner-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-pink-700">Convention-first outreach</p><h2 className="text-2xl font-bold" id="outreach-planner-title">Booking priority workspace</h2><p className="mt-1 text-sm text-slate-600">Portfolio priority reflects competing openings. Actual callbacks and replies stay visible regardless of rank.</p></div><button className="button-secondary min-h-11" type="button" onClick={() => void reload()}>Refresh planner</button></div>
    <ErrorMessage value={error} />{allocationError ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">Allocation details need retry: {allocationError}</p> : null}
    {!activeOpenings.length ? <OpeningSetup planner={planner} reload={reload} /> : null}

    <details className={panel} open={groups.contact.length > 0}><summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Contact next <span className="text-sm text-slate-500">({groups.contact.length})</span></summary><p className="mb-3 mt-1 text-sm text-slate-600">Only cross-opening first choices with current fitting evidence and a due cadence action appear here.</p><div className="grid gap-3">{groups.contact.length ? groups.contact.map(card) : <p className="text-sm text-slate-600">No candidate is both first choice and currently ready. Review the sections below.</p>}</div></details>
    <details className={panel}><summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Waiting / follow-ups <span className="text-sm text-slate-500">({groups.waiting.length})</span></summary><div className="mt-3 grid gap-3">{groups.waiting.length ? groups.waiting.map(card) : <p className="text-sm text-slate-600">No routine outreach is waiting.</p>}</div></details>
    <details className={panel}><summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Route openings and backups <span className="text-sm text-slate-500">({activeOpenings.length})</span></summary><div className="mt-3 grid gap-4">{activeOpenings.map((opening) => { const candidates = planner.candidates.filter((item) => item.openingId === opening.id && !item.releasedAt); return <section className="rounded-xl border border-slate-200 p-3" key={opening.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{opening.title}</h3><p className="text-sm text-slate-600">{date(opening.startsOn)} – {date(opening.endsOn)} · {planner.legs.find((item) => item.id === opening.legId)?.name ?? "Leg needs review"}</p><p className="text-sm text-slate-600">{packageText(opening, planner)}</p></div><div className="flex flex-wrap gap-2"><button className="button-secondary min-h-11" type="button" onClick={() => { const reason = window.prompt("Why is this opening filled?"); if (reason?.trim()) void setOpeningStatus(opening.id, "filled", reason.trim()).then(reload); }}>Mark filled</button><button className="button-secondary min-h-11" type="button" onClick={() => { const reason = window.prompt("Why is this opening closing?"); if (reason?.trim()) void setOpeningStatus(opening.id, "closed", reason.trim()).then(reload); }}>Close</button></div></div><div className="mt-3 grid gap-2">{candidates.map(card)}</div><div className="mt-3"><CandidatePicker opening={opening} reload={reload} /></div></section>; })}{activeOpenings.length ? <OpeningSetup planner={planner} reload={reload} /> : null}<AllocationReview allocations={allocations} planner={planner} reload={reload} /><CommittedBookingRecovery allocations={allocations} planner={planner} reload={reload} /></div></details>
    <details className={panel}><summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Find more leads <span className="text-sm text-slate-500">({planner.researchTasks.filter((item) => item.status !== "completed").length})</span></summary><div className="mt-3 grid gap-3">{activeOpenings.map((opening) => <ResearchForm key={opening.id} opening={opening} planner={planner} onCreated={reload} />)}{planner.researchTasks.length ? <ul className="grid gap-2">{planner.researchTasks.map((task) => { const taskOpening = planner.openings.find((item) => item.id === task.openingId); return <li className="rounded-lg border p-3 text-sm" key={task.id}><strong>{task.criteria}</strong><p>{label(task.status)} · {task.results?.filter((item) => item.qualified).length ?? 0} of {task.targetCount} qualifying profiles</p><p className="text-slate-600">Only results with verified dates, contact, fit, source URL, and checked date count.</p>{task.results?.length ? <ul className="mt-2 grid gap-1">{task.results.map((result) => <li className="rounded bg-slate-50 p-2" key={`${result.opportunityId}:${result.sourceUrl}`}><a className="break-words font-semibold text-pink-700 underline" href={result.sourceUrl} rel="noreferrer" target="_blank">Reviewed source</a> · {result.qualified ? "Qualifies for research target" : "Missing or unverified facts"}<p>{result.note}</p></li>)}</ul> : null}{taskOpening && task.status !== "completed" ? <div className="mt-2"><ResearchResultForm opening={taskOpening} planner={planner} reload={reload} task={task} /></div> : null}</li>; })}</ul> : null}</div></details>
    <details className={`${panel} ${groups.attention.length ? "border-amber-300" : ""}`} open={groups.attention.length > 0}><summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Needs review <span className="text-sm text-slate-500">({groups.attention.length})</span></summary><p className="mb-3 mt-1 text-sm text-slate-600">Replies, decisions, conflicts, stale checks, missing dates, unknown tiers, and source errors stay here until reviewed.</p><div className="grid gap-3">{groups.attention.length ? groups.attention.map(card) : <p className="text-sm text-slate-600">Nothing currently needs review.</p>}<DispatchRecovery /></div></details>
  </section>;
}

function looksHtml(body: string) {
  return /<\/?(?:html|body|div|p|table|br|span|h[1-6])\b/i.test(body);
}

export function useOutreachPlannerEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void getPlanner().then((value) => { if (active) setEnabled(value.enabled); }).catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);
  return enabled;
}

export function OutreachDraftReviewControl({ kind, draftId, content, dirty = false, onApprovalChange }: { kind: DraftKind; draftId: string; content?: DraftContent; dirty?: boolean; onApprovalChange?(current: boolean): void }) {
  const [review, setReview] = useState<DraftReviewResult | null>(null);
  const [intent, setIntent] = useState<"exploratory" | "administrative" | "specific_offer">("exploratory");
  const [stage, setStage] = useState<OutreachStage | "">("");
  const [holdId, setHoldId] = useState("");
  const [reason, setReason] = useState("");
  const [allocations, setAllocations] = useState<AllocationCatalog | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [identityQuery, setIdentityQuery] = useState("");
  const [identityYear, setIdentityYear] = useState(new Date().getFullYear());
  const [identityOptions, setIdentityOptions] = useState<OpportunityChoice[]>([]);
  const [identityOpportunityId, setIdentityOpportunityId] = useState("");
  const [identityReason, setIdentityReason] = useState("");
  const generation = useRef(0);
  const snapshot = `${kind}\u0000${draftId}\u0000${dirty}\u0000${content?.to ?? ""}\u0000${content?.subject ?? ""}\u0000${content?.body ?? ""}`;
  const snapshotRef = useRef(snapshot);
  if (snapshotRef.current !== snapshot) {
    snapshotRef.current = snapshot;
    generation.current += 1;
  }
  useEffect(() => { setReview(null); setAllocations(null); setHoldId(""); onApprovalChange?.(false); }, [snapshot]);
  function current(requestGeneration: number, requestSnapshot: string) {
    return generation.current === requestGeneration && snapshotRef.current === requestSnapshot;
  }
  async function load() {
    if (dirty) { setError("Save these subject and body changes before reviewing the final opportunity email."); return; }
    const requestGeneration = ++generation.current;
    const requestSnapshot = snapshotRef.current;
    setBusy("review"); setError("");
    try {
      const next = await reviewDraftContent(kind, draftId, content ?? {});
      if (!current(requestGeneration, requestSnapshot)) return;
      setReview(next); onApprovalChange?.(next.approvalCurrent);
      try {
        const nextAllocations = await getAllocations();
        if (current(requestGeneration, requestSnapshot)) setAllocations(nextAllocations);
      } catch { if (current(requestGeneration, requestSnapshot)) setAllocations(null); }
    } catch (cause) { if (current(requestGeneration, requestSnapshot)) setError(cause instanceof Error ? cause.message : "Could not load the final content review."); }
    finally { if (current(requestGeneration, requestSnapshot)) setBusy(""); }
  }
  async function approve() {
    if (!review || !reason.trim()) { setError("Review the exact final content and record the approval reason."); return; }
    if (intent === "specific_offer" && !holdId) { setError("Choose the live hold that matches this exact event and opportunity."); return; }
    const requestGeneration = ++generation.current;
    const requestSnapshot = snapshotRef.current;
    setBusy("approve"); setError("");
    try {
      await approveDraft(kind, draftId, { digest: review.digest, intent, holdId: intent === "specific_offer" ? holdId : null, stage: stage || null, overrides: content ?? {}, reason: reason.trim() });
      if (!current(requestGeneration, requestSnapshot)) return;
      const next = await reviewDraftContent(kind, draftId, content ?? {});
      if (!current(requestGeneration, requestSnapshot)) return;
      setReview(next); onApprovalChange?.(next.approvalCurrent);
    } catch (cause) { if (current(requestGeneration, requestSnapshot)) { setError(cause instanceof Error ? cause.message : "Could not approve this final content."); onApprovalChange?.(false); } }
    finally { if (current(requestGeneration, requestSnapshot)) setBusy(""); }
  }
  async function searchIdentity() {
    setBusy("identity-search"); setError(""); setIdentityOpportunityId("");
    try { setIdentityOptions(await searchOpportunities(identityQuery, identityYear)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not search event-year opportunities."); }
    finally { setBusy(""); }
  }
  async function assignIdentity() {
    if (!identityOpportunityId || !identityReason.trim()) { setError("Choose the verified event-year opportunity and record what you checked."); return; }
    setBusy("identity"); setError("");
    try {
      await assignOfficeIdentity(draftId, { opportunityId: identityOpportunityId, reason: identityReason.trim() });
      generation.current += 1; setReview(null); setAllocations(null); setHoldId(""); onApprovalChange?.(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not assign the draft identity."); setBusy(""); }
  }
  const hasExactIdentity = !!review?.draft.opportunityId && !!review.draft.bookingId && review.draft.eventYear !== null;
  const matchingHolds = hasExactIdentity ? allocations?.holds.filter((hold) => hold.state === "active" && hold.booking_id === review!.draft.bookingId && hold.opportunity_id === review!.draft.opportunityId) ?? [] : [];
  return <section className="rounded-xl border border-pink-200 bg-pink-50/40 p-3" aria-label="Final outreach review">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold">Final recipient, content and offer intent</h4><p className="text-sm text-slate-600">Approval binds the exact saved recipient, subject, body, event identity, and current hold.</p></div><button className="button-secondary min-h-11" disabled={!!busy || dirty} type="button" onClick={() => void load()}>{busy === "review" ? "Loading…" : review ? "Refresh final preview" : "Review final content"}</button></div>
    {dirty ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900">Save changes before review. Any subject, body, or recipient change requires a new review.</p> : null}<ErrorMessage value={error} />
    {review ? <div className="mt-3 grid gap-3"><section className="overflow-hidden rounded-lg border bg-white" aria-label="Exact final email preview"><div className="border-b p-3 text-sm"><p className="break-words"><strong>To:</strong> {review.draft.content.to}</p><p className="break-words"><strong>Subject:</strong> {review.draft.content.subject}</p></div>{looksHtml(review.draft.content.body) ? <iframe className="min-h-80 w-full" sandbox="" srcDoc={review.draft.content.body} title="Final email body preview" /> : <pre className="min-h-40 whitespace-pre-wrap break-words p-3 font-sans text-sm">{review.draft.content.body}</pre>}</section>
      {review.dispatch && ["dispatching", "uncertain"].includes(review.dispatch.state) ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">Delivery is {review.dispatch.state}. Check the provider and reconcile the outcome before any resend.</p> : null}
      {review.reviewReasons.map((item) => <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" key={item}>{item}</p>)}
      {kind === "office_email" && !hasExactIdentity ? <section className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3" aria-label="Assign Office draft event identity"><div><h5 className="font-bold">Assign the verified event-year opportunity</h5><p className="text-sm text-amber-900">Search by organization or event name and year. Specific offers remain unavailable until the draft has exact opportunity and booking identity.</p></div><div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end"><label className="grid gap-1 text-sm font-semibold">Opportunity name<input className={input} value={identityQuery} onChange={(event) => setIdentityQuery(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Event year<input className={input} type="number" min="2000" max="2200" value={identityYear} onChange={(event) => setIdentityYear(Number(event.target.value))} /></label><button className="button-secondary min-h-11" disabled={busy !== "" || !identityQuery.trim()} type="button" onClick={() => void searchIdentity()}>Search</button></div>{identityOptions.length ? <label className="grid gap-1 text-sm font-semibold">Verified opportunity<select className={input} value={identityOpportunityId} onChange={(event) => setIdentityOpportunityId(event.target.value)}><option value="">Choose the matching opportunity</option>{identityOptions.map((item) => <option key={item.id} value={item.id}>{item.organizationName} · {item.eventYear} · {item.bookingId ? "linked event" : "booking needs review"}</option>)}</select></label> : null}<label className="grid gap-1 text-sm font-semibold">Identity review reason<textarea className={input} value={identityReason} onChange={(event) => setIdentityReason(event.target.value)} /></label><button className="button-secondary min-h-11 w-fit" disabled={busy !== "" || !identityOpportunityId || !identityReason.trim()} type="button" onClick={() => void assignIdentity()}>{busy === "identity" ? "Assigning…" : "Assign identity and refresh review"}</button></section> : null}
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Intent<select className={input} value={intent} onChange={(event) => setIntent(event.target.value as typeof intent)}><option value="exploratory">Exploratory outreach</option><option value="administrative">Administrative message</option><option value="specific_offer">Specific offer</option></select></label><label className="grid gap-1 text-sm font-semibold">Cadence stage (optional)<select className={input} value={stage} onChange={(event) => setStage(event.target.value as OutreachStage | "")}><option value="">No cadence stage</option>{stages.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label></div>
      {intent === "specific_offer" ? <label className="grid gap-1 text-sm font-semibold">Matching live hold<select className={input} value={holdId} onChange={(event) => setHoldId(event.target.value)}><option value="">Choose a matching live hold</option>{matchingHolds.map((hold) => <option key={hold.id} value={hold.id}>Expires {instant(hold.expires_at)} ({BUSINESS_TIME_ZONE}) · {Object.values(hold.quantities).reduce((sum, value) => sum + value, 0)} requested</option>)}</select>{!hasExactIdentity ? <span className="font-normal text-amber-900">Assign exact opportunity, booking, and event-year identity before choosing a hold.</span> : !matchingHolds.length ? <span className="font-normal text-amber-900">No matching live hold is available. Create and verify it in Today first.</span> : null}</label> : null}
      <label className="grid gap-1 text-sm font-semibold">Approval reason<textarea className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="button-primary min-h-11 w-fit" disabled={!!busy || !reason.trim()} type="button" onClick={() => void approve()}>{busy === "approve" ? "Approving…" : "Approve this exact final content"}</button>{review.approvalCurrent ? <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">Exact final content and intent are approved for the guarded send path.</p> : null}</div> : null}
  </section>;
}

export function OutreachProfileSummary({ organizationId }: { organizationId: string }) {
  const [planner, setPlanner] = useState<Planner | null>(null);
  useEffect(() => { let active = true; void getPlanner().then((value) => { if (active) setPlanner(value); }).catch(() => undefined); return () => { active = false; }; }, [organizationId]);
  if (!planner?.enabled) return null;
  const candidates = planner.candidates.filter((item) => item.organizationId === organizationId);
  if (!candidates.length) return <section className={panel}><h2 className="font-bold">Outreach openings</h2><p className="mt-1 text-sm text-slate-600">This profile is not currently in an outreach opening. Add it by name from Today after selecting the correct event year and booking identity.</p></section>;
  return <section className={panel} aria-labelledby="profile-outreach-title"><h2 className="font-bold" id="profile-outreach-title">Outreach openings</h2><div className="mt-3 grid gap-2">{candidates.map((candidate) => { const opening = planner.openings.find((item) => item.id === candidate.openingId); return <div className="rounded-lg bg-slate-50 p-3 text-sm" key={candidate.id}><div className="flex flex-wrap justify-between gap-2"><strong>{opening?.title ?? "Unknown opening"} · {candidate.eventYear}</strong><span>{label(candidate.portfolio.state)}</span></div><p className="mt-1">{candidate.portfolio.reason}</p><p className="text-slate-600">Actual event: {date(candidate.eventStartsAt)}{candidate.eventEndsAt ? ` – ${date(candidate.eventEndsAt)}` : ""} · {label(candidate.tier)}</p>{candidate.capacity.status !== "fits" ? <p className="mt-1 font-semibold text-amber-900">Availability remains {label(candidate.capacity.status)}.</p> : null}</div>; })}</div></section>;
}
