import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import { FollowUpList } from "@/components/today/follow-up-list";
import { CallQueueWorkspace } from "@/components/today/call-queue-workspace";
import { NextCallCard, eventProfileHref } from "@/components/today/next-call-card";
import { BookingOperations } from "@/components/today/booking-operations";
import { RenewalsSection } from "@/components/today/renewals-section";
import { NeedsAttention } from "@/components/today/needs-attention";
import { ProfileDetailSheet, type ProfileSheetTarget } from "@/components/profiles/profile-detail-sheet";
import { AssistantTransientContext } from "@/components/assistant/assistant-transient-context";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(value);
}

function statusLabel(value: string | null | undefined) {
  if (!value) return "Needs action";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type CallingConfig = { assistedCallingEnabled: boolean; voicemailLauncherUrl: string | null };
type LabeledProfileSheetTarget = ProfileSheetTarget & { label?: string };
const disabledCallingConfig: CallingConfig = { assistedCallingEnabled: false, voicemailLauncherUrl: null };

function coerceFollowUps(items: any[]) {
  return (items ?? []).map((followUp) => ({ ...followUp, dueAt: new Date(followUp.dueAt), lastContactedAt: followUp.lastContactedAt ? new Date(followUp.lastContactedAt) : null }));
}

function coerceRenewals(items: any[]) {
  return (items ?? []).map((renewal) => ({ ...renewal, dueAt: renewal.dueAt ? new Date(renewal.dueAt) : null }));
}

export default function TodayPage() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callingConfig, setCallingConfig] = useState<CallingConfig>(disabledCallingConfig);
  const [profileTarget, setProfileTarget] = useState<LabeledProfileSheetTarget | null>(null);
  const [manageNextSteps, setManageNextSteps] = useState(false);
  const [selectedNextSteps, setSelectedNextSteps] = useState<Set<string>>(new Set());
  const [hiddenNextSteps, setHiddenNextSteps] = useState<Set<string>>(new Set());
  const [actionOpenId, setActionOpenId] = useState<string | null>(null);
  const [showAllNextSteps, setShowAllNextSteps] = useState(false);
  const [undoBookingIds, setUndoBookingIds] = useState<string[]>([]);
  const [nextStepError, setNextStepError] = useState<string | null>(null);
  const [nextStepBusy, setNextStepBusy] = useState(false);
  const now = new Date();

  useEffect(() => {
    Promise.all([apiGet<any>("/today"), apiGet<CallingConfig>("/calls/config").catch(() => disabledCallingConfig)])
      .then(([d, config]) => { setDashboard(d); setCallingConfig(config); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  function handleProfileLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const href = element?.getAttribute("href") ?? "";
    const match = href.match(/^\/(?:event-profiles|profiles)\/([^/?#]+)/);
    if (!match?.[1]) return;
    event.preventDefault();
    const queryString = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    const linkParams = new URLSearchParams(queryString);
    setProfileTarget({
      profileId: decodeURIComponent(match[1]),
      contactId: linkParams.get("contactId") ?? undefined,
      bookingId: linkParams.get("bookingId") ?? undefined,
      label: element?.textContent?.trim() || "Side profile",
    });
  }

  async function clearNextSteps(bookingIds: string[]) {
    if (!bookingIds.length || nextStepBusy) return;
    setNextStepBusy(true);
    setNextStepError(null);
    try {
      await apiPost("/today/next-step/clear", { bookingIds, reason: "no_follow_up_needed" });
      setHiddenNextSteps((current) => new Set([...current, ...bookingIds]));
      setSelectedNextSteps(new Set());
      setUndoBookingIds(bookingIds);
      setActionOpenId(null);
    } catch (cause) {
      setNextStepError(cause instanceof Error ? cause.message : "Could not clear the selected items.");
    } finally {
      setNextStepBusy(false);
    }
  }

  async function snoozeNextSteps(bookingIds: string[]) {
    if (!bookingIds.length || nextStepBusy) return;
    setNextStepBusy(true);
    setNextStepError(null);
    try {
      const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await apiPost("/today/next-step/snooze", { bookingIds, dueAt });
      setHiddenNextSteps((current) => new Set([...current, ...bookingIds]));
      setSelectedNextSteps(new Set());
      setActionOpenId(null);
    } catch (cause) {
      setNextStepError(cause instanceof Error ? cause.message : "Could not snooze the selected items.");
    } finally {
      setNextStepBusy(false);
    }
  }

  async function undoClear() {
    if (!undoBookingIds.length || nextStepBusy) return;
    setNextStepBusy(true);
    setNextStepError(null);
    try {
      await apiPost("/today/next-step/reopen", { bookingIds: undoBookingIds });
      setHiddenNextSteps((current) => {
        const next = new Set(current);
        undoBookingIds.forEach((id) => next.delete(id));
        return next;
      });
      setUndoBookingIds([]);
    } catch (cause) {
      setNextStepError(cause instanceof Error ? cause.message : "Could not restore the cleared items.");
    } finally {
      setNextStepBusy(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-5xl py-20 text-center text-slate-500">Loading Today…</div>;
  if (error || !dashboard) return <div className="mx-auto max-w-5xl"><div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-6"><p className="font-semibold text-rose-800">Could not load Today</p><p className="mt-1 text-sm text-rose-700">{error}</p></div></div>;

  const followUps = coerceFollowUps(dashboard.followUps ?? []);
  const renewals = coerceRenewals(dashboard.renewals ?? []);
  const upcomingEvents = (dashboard.upcomingEvents ?? []).map((e: any) => ({ ...e, startsAt: e.startsAt ? new Date(e.startsAt) : null }));
  const nextStepItems = (dashboard.needsFollowUpPlan ?? []).filter((booking: any) => !hiddenNextSteps.has(booking.id));
  const displayedNextStepItems = showAllNextSteps ? nextStepItems : nextStepItems.slice(0, 8);
  const firstNewLead = nextStepItems.find((b: any) => b.status === "new_lead");
  const newLeadHref = firstNewLead ? eventProfileHref({ organizationId: firstNewLead.organizationId ?? null, contactId: firstNewLead.primaryContactId, bookingId: firstNewLead.id, mode: "prospect" }) ?? undefined : undefined;

  return (
    <div className="mx-auto grid max-w-5xl gap-5" onClickCapture={handleProfileLink}>
      <header className="flex items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Command Center</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1><p className="mt-1 text-sm text-slate-600">Work the next thing, then keep moving down the queue.</p></div></header>

      {callingConfig.assistedCallingEnabled ? <section className="grid gap-2" aria-labelledby="up-next-title"><h2 className="text-xl font-bold" id="up-next-title">Up Next</h2><CallQueueWorkspace callingConfig={callingConfig} followUps={followUps} initialFollowUpId={dashboard.nextCall?.id} refreshToday={async () => { const refreshed = await apiGet<any>("/today"); setDashboard(refreshed); return { followUps: coerceFollowUps(refreshed.followUps ?? []), followUpTotal: refreshed.followUpTotal ?? 0 }; }} remainingCount={dashboard.followUpTotal ?? followUps.length} /></section> : <NextCallCard followUp={dashboard.nextCall ? { ...dashboard.nextCall, dueAt: new Date(dashboard.nextCall.dueAt) } : null} />}

      {!callingConfig.assistedCallingEnabled ? <FollowUpList followUps={followUps} now={now} /> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3"><div><h2 className="text-xl font-bold">Upcoming Events</h2><p className="mt-1 text-sm text-slate-600">The next dated bookings.</p></div><Link className="text-sm font-semibold text-orange-700" href="/schedule">Open Schedule</Link></div>
        {upcomingEvents.length ? <ul className="mt-4 grid gap-2">{upcomingEvents.map((event: any) => <li className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3" key={event.id}><div className="min-w-0"><Link className="font-semibold text-slate-950 hover:text-orange-700" href={eventProfileHref({ organizationId: event.organizationId ?? null, contactId: event.primaryContactId, bookingId: event.id }) ?? `/bookings/${event.id}`}>{event.name}</Link><BookingOperations operations={event.operations} /></div>{event.startsAt ? <span className="whitespace-nowrap text-sm text-slate-600">{formatDate(event.startsAt)}</span> : null}</li>)}</ul> : <p className="mt-4 text-sm text-slate-600">No upcoming event dates are set.</p>}
      </section>

      <NeedsAttention contractCount={dashboard.contractCount ?? 0} followUpCount={dashboard.followUpCount ?? 0} newLeadCount={dashboard.newLeadCount ?? 0} newLeadHref={newLeadHref} visibleRouteWarningCount={dashboard.visibleRouteWarningCount ?? 0} />

      {nextStepItems.length || undoBookingIds.length ? (
        <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" open>
          <summary className="cursor-pointer font-bold">Needs a next step ({nextStepItems.length})</summary>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-slate-600">These leads or past events do not have another reminder scheduled yet.</p>
            {nextStepItems.length ? <button className="text-sm font-semibold text-orange-700" type="button" aria-label="Manage next steps" onClick={() => { setManageNextSteps((value) => !value); setSelectedNextSteps(new Set()); }}>{manageNextSteps ? "Done" : "Manage"}</button> : null}
          </div>

          {undoBookingIds.length ? <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><span>Cleared from Today.</span><button className="font-semibold underline" type="button" onClick={undoClear} disabled={nextStepBusy}>Undo</button></div> : null}
          {nextStepError ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{nextStepError}</p> : null}

          {manageNextSteps && nextStepItems.length ? <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-slate-50 p-3"><button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" type="button" disabled={!selectedNextSteps.size || nextStepBusy} onClick={() => clearNextSteps([...selectedNextSteps])}>Clear selected</button><button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" type="button" disabled={!selectedNextSteps.size || nextStepBusy} onClick={() => snoozeNextSteps([...selectedNextSteps])}>Snooze selected 1 week</button></div> : null}

          {nextStepItems.length ? <ul className="mt-4 grid gap-2">{displayedNextStepItems.map((booking: any) => {
            const href = eventProfileHref({ organizationId: booking.organizationId ?? null, contactId: booking.primaryContactId, bookingId: booking.id, mode: booking.status === "new_lead" ? "prospect" : undefined }) ?? `/bookings/${booking.id}`;
            return <li className="relative flex items-start gap-3 rounded-xl border border-slate-100 p-3" key={booking.id}>
              {manageNextSteps ? <input className="mt-1 h-4 w-4" type="checkbox" aria-label={`Select ${booking.name}`} checked={selectedNextSteps.has(booking.id)} onChange={(event) => setSelectedNextSteps((current) => { const next = new Set(current); if (event.target.checked) next.add(booking.id); else next.delete(booking.id); return next; })} /> : null}
              <div className="min-w-0 flex-1"><Link className="font-semibold text-slate-950 hover:text-orange-700" href={href}>{booking.name}</Link><p className="mt-1 text-sm text-slate-600">{booking.planReason === "post_event" ? "Past event · Needs follow-up decision" : `${statusLabel(booking.status)} · Needs follow-up decision`}</p></div>
              {!manageNextSteps ? <div className="relative"><button className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100" type="button" aria-label={`More actions for ${booking.name}`} onClick={() => setActionOpenId((current) => current === booking.id ? null : booking.id)}>⋯</button>{actionOpenId === booking.id ? <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"><Link className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50" href={href}>Open profile</Link><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" type="button" onClick={() => snoozeNextSteps([booking.id])}>Snooze 1 week</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50" type="button" onClick={() => clearNextSteps([booking.id])}>No follow-up needed</button></div> : null}</div> : null}
            </li>;
          })}</ul> : <p className="mt-4 text-sm text-slate-600">Nothing needs a next step right now.</p>}
          {nextStepItems.length > 8 ? <button className="mt-3 text-sm font-semibold text-orange-700" type="button" onClick={() => setShowAllNextSteps((value) => !value)}>{showAllNextSteps ? "Show less" : `View all ${nextStepItems.length}`}</button> : null}
        </details>
      ) : null}

      {(dashboard.todayTrips ?? []).length ? <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-bold">Today’s trips ({dashboard.todayTrips.length})</summary><ul className="mt-4 grid gap-2">{dashboard.todayTrips.map((trip: any) => <li key={trip.id}><Link className="font-semibold hover:text-orange-700" href={`/trips/${trip.id}`}>{trip.name}</Link><span className="ml-2 text-sm text-slate-600">{trip.legName ? `${trip.legName} · ` : ""}{trip.stopCount} stops</span></li>)}</ul></details> : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-bold">More for later</summary><div className="mt-4"><RenewalsSection error={dashboard.renewalError ?? null} prominentCount={dashboard.renewalProminentCount ?? 0} renewals={renewals} total={dashboard.renewalTotal ?? renewals.length} /></div></details>

      {profileTarget?.profileId ? <AssistantTransientContext open kind="organization" recordId={profileTarget.profileId} label={profileTarget.label ?? "Side profile"} /> : null}
      <ProfileDetailSheet open={Boolean(profileTarget)} onOpenChange={(open) => { if (!open) setProfileTarget(null); }} target={profileTarget} />
    </div>
  );
}
