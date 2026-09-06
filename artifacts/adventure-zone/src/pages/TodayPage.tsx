import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import { FollowUpList } from "@/components/today/follow-up-list";
import { CallQueueWorkspace } from "@/components/today/call-queue-workspace";
import { NextCallCard, eventProfileHref } from "@/components/today/next-call-card";
import { BookingOperations } from "@/components/today/booking-operations";
import { RenewalsSection } from "@/components/today/renewals-section";
import { ScoutAlertsSection, type ScoutAlertView } from "@/components/today/scout-alerts-section";
import { BUSINESS_TIME_ZONE, classifyBusinessDueDate } from "@/lib/business-date";
import { classifyTodayEventTiming } from "@/features/today/today-summary-labels";
import { deriveTodayFocus } from "@/features/today/today-focus";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(value);
}

function formatEventDateRange(startsAt: Date, endsAt: Date | null) {
  if (!endsAt || startsAt.toDateString() === endsAt.toDateString()) return formatDate(startsAt);
  return `${formatDate(startsAt)} – ${formatDate(endsAt)}`;
}

function formatToday(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function statusLabel(value: string | null | undefined) {
  if (!value) return "Needs action";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type CallingConfig = { assistedCallingEnabled: boolean; voicemailLauncherUrl: string | null };
const disabledCallingConfig: CallingConfig = { assistedCallingEnabled: false, voicemailLauncherUrl: null };

function coerceFollowUps(items: any[]) {
  return (items ?? []).map((followUp) => ({ ...followUp, dueAt: new Date(followUp.dueAt), lastContactedAt: followUp.lastContactedAt ? new Date(followUp.lastContactedAt) : null }));
}

function coerceRenewals(items: any[]) {
  return (items ?? []).map((renewal) => ({ ...renewal, dueAt: renewal.dueAt ? new Date(renewal.dueAt) : null }));
}

function FocusPrimaryAction({ href, label }: { href: string; label: string }) {
  const classes = "inline-flex items-center justify-center rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-orange-700";
  return href.startsWith("#")
    ? <a className={classes} href={href}>{label}</a>
    : <Link className={classes} href={href}>{label}</Link>;
}

export default function TodayPage() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callingConfig, setCallingConfig] = useState<CallingConfig>(disabledCallingConfig);
  const [scoutAlerts, setScoutAlerts] = useState<ScoutAlertView[]>([]);
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
      .then(([d, config]) => {
        setDashboard(d);
        setScoutAlerts(Array.isArray(d.scoutAlerts) ? d.scoutAlerts : []);
        setCallingConfig(config);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  async function snoozeScoutAlert(alertId: string) {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await apiPost(`/today/scout-alerts/${alertId}/snooze`, { until });
    setScoutAlerts((current) => current.filter((alert) => alert.id !== alertId));
  }

  async function dismissScoutAlert(alertId: string) {
    await apiPost(`/today/scout-alerts/${alertId}/dismiss`, {});
    setScoutAlerts((current) => current.filter((alert) => alert.id !== alertId));
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
  const upcomingEvents = (dashboard.upcomingEvents ?? []).map((event: any) => ({
    ...event,
    startsAt: event.startsAt ? new Date(event.startsAt) : null,
    endsAt: event.endsAt ? new Date(event.endsAt) : null,
  }));
  const nextStepItems = (dashboard.needsFollowUpPlan ?? []).filter((booking: any) => !hiddenNextSteps.has(booking.id));
  const displayedNextStepItems = showAllNextSteps ? nextStepItems : nextStepItems.slice(0, 8);
  const overdueFollowUps = followUps.filter((followUp: any) => classifyBusinessDueDate(followUp.dueAt, now) === "overdue");
  const dueTodayFollowUps = followUps.filter((followUp: any) => classifyBusinessDueDate(followUp.dueAt, now) === "today");
  const laterFollowUps = followUps.filter((followUp: any) => classifyBusinessDueDate(followUp.dueAt, now) === "future");
  const actionableFollowUps = [...overdueFollowUps, ...dueTodayFollowUps];
  const overdueCount = overdueFollowUps.length;
  const dueTodayCount = dueTodayFollowUps.length;
  const laterCount = laterFollowUps.length;
  const contractCount = dashboard.contractCount ?? 0;
  const visibleRouteWarningCount = dashboard.visibleRouteWarningCount ?? 0;
  const urgentScoutAlertCount = scoutAlerts.filter((alert) => alert.severity === "urgent").length;
  const focus = deriveTodayFocus({
    overdueFollowUpCount: overdueCount,
    dueTodayFollowUpCount: dueTodayCount,
    laterFollowUpCount: laterCount,
    followUpCount: followUps.length,
    contractCount,
    decisionCount: nextStepItems.length,
    upcomingEventCount: upcomingEvents.length,
  });
  const nextEvent = upcomingEvents[0] ?? null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 pb-8">
      <header className="border-b border-slate-200 pb-5">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Command Center</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">{formatToday(now)}</p>
      </header>

      <section className="rounded-2xl border border-orange-200 bg-orange-50/70 p-5 shadow-sm" aria-labelledby="start-here-title">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Start here</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold" id="start-here-title">{focus.headline}</h2>
            <p className="mt-1 text-sm font-medium text-slate-600">{focus.detail}</p>
          </div>
          <FocusPrimaryAction href={focus.primaryHref} label={focus.primaryLabel} />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
          {actionableFollowUps.length ? <a className="text-orange-700 hover:underline" href="#my-work-calls">Calls & follow-ups</a> : laterFollowUps.length ? <a className="text-orange-700 hover:underline" href="#later-work">Calls & follow-ups</a> : null}
          <Link className="text-orange-700 hover:underline" href="/profiles">Booking work</Link>
          <Link className="text-orange-700 hover:underline" href="/research-sources">Find opportunities</Link>
          <Link className="text-orange-700 hover:underline" href="/schedule">View schedule</Link>
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="my-work-title">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold" id="my-work-title">My Work</h2>
          <span className="text-sm font-semibold text-slate-500">Only open what you want to work on</span>
        </div>

        {actionableFollowUps.length ? (
          <details id="my-work-calls" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer font-bold">
              Calls & follow-ups <span className="ml-1 text-slate-500">({actionableFollowUps.length})</span>
              {overdueCount ? <span className="ml-2 text-xs font-bold text-rose-700">{overdueCount} overdue</span> : null}
              {dueTodayCount ? <span className="ml-2 text-xs font-bold text-orange-700">{dueTodayCount} today</span> : null}
              {laterCount ? <span className="ml-2 text-xs font-semibold text-slate-500">{laterCount} later</span> : null}
            </summary>
            <div className="mt-4">
              {callingConfig.assistedCallingEnabled
                ? <CallQueueWorkspace callingConfig={callingConfig} followUps={actionableFollowUps} initialFollowUpId={dashboard.nextCall?.id} refreshToday={async () => { const refreshed = await apiGet<any>("/today"); setDashboard(refreshed); setScoutAlerts(Array.isArray(refreshed.scoutAlerts) ? refreshed.scoutAlerts : []); const refreshedFollowUps = coerceFollowUps(refreshed.followUps ?? []); const refreshedActionable = refreshedFollowUps.filter((followUp: any) => { const due = classifyBusinessDueDate(followUp.dueAt, new Date()); return due === "overdue" || due === "today"; }); return { followUps: refreshedActionable, followUpTotal: refreshedActionable.length }; }} remainingCount={actionableFollowUps.length} />
                : <div className="grid gap-4"><NextCallCard followUp={dashboard.nextCall ? { ...dashboard.nextCall, dueAt: new Date(dashboard.nextCall.dueAt) } : null} /><FollowUpList followUps={actionableFollowUps} now={now} /></div>}
            </div>
          </details>
        ) : null}

        {contractCount > 0 ? (
          <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer font-bold">Contracts <span className="ml-1 text-slate-500">({contractCount})</span></summary>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">Booking and contract work that needs your attention.</p>
              <Link className="text-sm font-bold text-orange-700 hover:underline" href="/profiles">Open booking work</Link>
            </div>
          </details>
        ) : null}

        <ScoutAlertsSection
          alerts={scoutAlerts}
          urgentCount={urgentScoutAlertCount}
          onSnooze={snoozeScoutAlert}
          onDismiss={dismissScoutAlert}
        />

        {nextStepItems.length || undoBookingIds.length ? (
          <details id="my-work-decisions" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer font-bold">Needs a decision <span className="ml-1 text-slate-500">({nextStepItems.length})</span></summary>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm text-slate-600">Leads or past events with no future reminder scheduled.</p>
              {nextStepItems.length ? <button className="text-sm font-semibold text-orange-700" type="button" aria-label="Manage next steps" onClick={() => { setManageNextSteps((value) => !value); setSelectedNextSteps(new Set()); }}>{manageNextSteps ? "Done" : "Manage"}</button> : null}
            </div>

            {undoBookingIds.length ? <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><span>Cleared from Today.</span><button className="font-semibold underline" type="button" onClick={undoClear} disabled={nextStepBusy}>Undo</button></div> : null}
            {nextStepError ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{nextStepError}</p> : null}

            {manageNextSteps && nextStepItems.length ? <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-slate-50 p-3"><button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" type="button" disabled={!selectedNextSteps.size || nextStepBusy} onClick={() => clearNextSteps([...selectedNextSteps])}>Clear selected</button><button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" type="button" disabled={!selectedNextSteps.size || nextStepBusy} onClick={() => snoozeNextSteps([...selectedNextSteps])}>Snooze selected 1 week</button></div> : null}

            {nextStepItems.length ? <ul className="mt-3 divide-y divide-slate-100">{displayedNextStepItems.map((booking: any) => {
              const href = eventProfileHref({ organizationId: booking.organizationId ?? null, contactId: booking.primaryContactId, bookingId: booking.id, mode: booking.status === "new_lead" ? "prospect" : undefined }) ?? `/bookings/${booking.id}`;
              const suggestedLeg = (dashboard.travelLegs ?? []).find((leg: any) => leg.id === booking.legAssignment?.suggestedLegId);
              return <li className="relative flex items-start gap-3 py-3 first:pt-1 last:pb-0" key={booking.id}>
                {manageNextSteps ? <input className="mt-1 h-4 w-4" type="checkbox" aria-label={`Select ${booking.name}`} checked={selectedNextSteps.has(booking.id)} onChange={(event) => setSelectedNextSteps((current) => { const next = new Set(current); if (event.target.checked) next.add(booking.id); else next.delete(booking.id); return next; })} /> : null}
                <div className="min-w-0 flex-1"><Link className="font-semibold text-slate-950 hover:text-orange-700" href={href}>{booking.name}</Link><p className="mt-0.5 text-sm text-slate-600">{booking.planReason === "post_event" ? "Past event · Needs follow-up decision" : `${statusLabel(booking.status)} · Needs follow-up decision`}</p>{suggestedLeg ? <p className="mt-1 text-xs font-bold text-emerald-700">Suggested leg: {suggestedLeg.name}</p> : booking.status === "new_lead" ? <p className="mt-1 text-xs font-semibold text-amber-700">Leg suggestion needs dates and location</p> : null}{booking.copilot?.headline ? <p className="mt-1 text-xs font-semibold text-orange-700">{booking.copilot.headline}</p> : null}</div>
                {!manageNextSteps ? <div className="relative"><button className="rounded-lg px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100" type="button" aria-label={`More actions for ${booking.name}`} onClick={() => setActionOpenId((current) => current === booking.id ? null : booking.id)}>⋯</button>{actionOpenId === booking.id ? <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"><Link className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50" href={href}>Open profile</Link><button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" type="button" onClick={() => snoozeNextSteps([booking.id])}>Snooze 1 week</button><button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50" type="button" onClick={() => clearNextSteps([booking.id])}>No follow-up needed</button></div> : null}</div> : null}
              </li>;
            })}</ul> : <p className="mt-4 text-sm text-slate-600">Nothing needs a next step right now.</p>}
            {nextStepItems.length > 8 ? <button className="mt-3 text-sm font-semibold text-orange-700" type="button" onClick={() => setShowAllNextSteps((value) => !value)}>{showAllNextSteps ? "Show less" : `View all ${nextStepItems.length}`}</button> : null}
          </details>
        ) : null}
      </section>

      {visibleRouteWarningCount > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm" aria-label="Needs attention">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold text-amber-950">Route planning needs attention</p><p className="mt-1 text-sm text-amber-800">{visibleRouteWarningCount} route warning{visibleRouteWarningCount === 1 ? "" : "s"} need a look.</p></div>
            <Link className="text-sm font-bold text-amber-900 underline" href="/routes">Review routes</Link>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="coming-up-title">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold" id="coming-up-title">Coming up</h2>
          <Link className="text-sm font-bold text-orange-700 hover:underline" href="/schedule">View schedule</Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {nextEvent ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next event</p><Link className="mt-1 block text-lg font-bold text-slate-950 hover:text-orange-700" href={eventProfileHref({ organizationId: nextEvent.organizationId ?? null, contactId: nextEvent.primaryContactId, bookingId: nextEvent.id }) ?? `/bookings/${nextEvent.id}`}>{nextEvent.name}</Link><BookingOperations operations={nextEvent.operations} /></div>
              {nextEvent.startsAt ? <span className="text-sm font-semibold text-slate-600">{formatEventDateRange(nextEvent.startsAt, nextEvent.endsAt)}</span> : null}
            </div>
          ) : <p className="text-sm text-slate-600">No upcoming event dates are set.</p>}
          {upcomingEvents.length > 1 ? <p className="mt-3 text-xs font-semibold text-slate-500">{upcomingEvents.length - 1} more upcoming event{upcomingEvents.length - 1 === 1 ? "" : "s"}</p> : null}
        </div>
      </section>

      <details id="later-work" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold">Later{laterCount ? <span className="ml-2 text-sm font-semibold text-slate-500">{laterCount} scheduled follow-up{laterCount === 1 ? "" : "s"}</span> : null}</summary>
        <p className="mt-1 text-sm text-slate-600">Future follow-ups, schedule detail, trips, and renewals are here when you want them.</p>
        <div className="mt-4 grid gap-3">
          {laterFollowUps.length ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Scheduled follow-ups <span className="ml-1 text-slate-500">({laterFollowUps.length})</span></summary><div className="mt-3"><FollowUpList followUps={laterFollowUps} now={now} /></div></details> : null}

          {upcomingEvents.length ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Current & upcoming events <span className="ml-1 text-slate-500">({upcomingEvents.length})</span></summary><ul className="mt-2 divide-y divide-slate-100">{upcomingEvents.map((event: any) => {
            const timing = classifyTodayEventTiming(event, now);
            return <li className="flex items-start justify-between gap-3 py-3" key={event.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link className="font-semibold text-slate-950 hover:text-orange-700" href={eventProfileHref({ organizationId: event.organizationId ?? null, contactId: event.primaryContactId, bookingId: event.id }) ?? `/bookings/${event.id}`}>{event.name}</Link><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${timing === "in_progress" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{timing === "in_progress" ? "In progress" : "Upcoming"}</span></div><BookingOperations operations={event.operations} /></div>{event.startsAt ? <span className="whitespace-nowrap text-sm text-slate-600">{formatEventDateRange(event.startsAt, event.endsAt)}</span> : null}</li>;
          })}</ul></details> : null}

          {(dashboard.todayTrips ?? []).length ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Today's trips <span className="ml-1 text-slate-500">({dashboard.todayTrips.length})</span></summary><ul className="mt-3 divide-y divide-slate-100">{dashboard.todayTrips.map((trip: any) => <li className="py-3" key={trip.id}><Link className="font-semibold hover:text-orange-700" href={`/trips/${trip.id}`}>{trip.name}</Link><span className="ml-2 text-sm text-slate-600">{trip.legName ? `${trip.legName} · ` : ""}{trip.stopCount} stops</span></li>)}</ul></details> : null}

          {(dashboard.renewalTotal ?? renewals.length) > 0 || dashboard.renewalError ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Renewals <span className="ml-1 text-slate-500">({dashboard.renewalTotal ?? renewals.length})</span></summary><div className="mt-4"><RenewalsSection error={dashboard.renewalError ?? null} prominentCount={dashboard.renewalProminentCount ?? 0} renewals={renewals} total={dashboard.renewalTotal ?? renewals.length} /></div></details> : null}
        </div>
      </details>

    </div>
  );
}
