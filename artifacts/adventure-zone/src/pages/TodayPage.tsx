import { UpcomingDeadlines } from "@/features/deadline-rules/reminders";
import { MasterWorkQueue } from "@/components/today/master-work-queue";
import { DailyWorkspace } from "@/components/today/daily-workspace";
import { FollowUpBoard } from "@/components/today/follow-up-board";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { coerceMasterTodayQueue } from "@/features/today/master-work-types";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import { CallQueueWorkspace } from "@/components/today/call-queue-workspace";
import { eventProfileHref } from "@/components/today/next-call-card";
import { BookingOperations } from "@/components/today/booking-operations";
import { InvoiceContractWorkspaceCard } from "@/components/today/invoice-contract-workspace-card";
import { RenewalsSection } from "@/components/today/renewals-section";
import { ScoutAlertsSection, type ScoutAlertView } from "@/components/today/scout-alerts-section";
import { BUSINESS_TIME_ZONE, classifyBusinessDueDate } from "@/lib/business-date";
import { classifyTodayEventTiming } from "@/features/today/today-summary-labels";
import { LegCallList } from "@/components/today/leg-call-list";
import { OutreachPlanner } from "@/components/today/outreach-planner";

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

type CallingConfig = { assistedCallingEnabled: boolean; voicemailLauncherUrl: string | null };
const disabledCallingConfig: CallingConfig = { assistedCallingEnabled: false, voicemailLauncherUrl: null };

function coerceFollowUps(items: any[]) {
  return (items ?? []).map((followUp) => ({ ...followUp, dueAt: new Date(followUp.dueAt), lastContactedAt: followUp.lastContactedAt ? new Date(followUp.lastContactedAt) : null }));
}

function coerceRenewals(items: any[]) {
  return (items ?? []).map((renewal) => ({ ...renewal, dueAt: renewal.dueAt ? new Date(renewal.dueAt) : null }));
}

export default function TodayPage({ leadsOnly = false }: { leadsOnly?: boolean }) {
  const [showTools, setShowTools] = useState(false);
  if (leadsOnly) return <LegacyTodayPage leadsOnly />;
  return <div className="mx-auto grid max-w-6xl gap-5 pb-8">
    <header><p className="text-xs font-bold uppercase text-primary">Command Center</p><h1 className="text-3xl font-bold">Today</h1><p className="text-sm text-muted-foreground">Follow-ups and next steps · Mountain time</p></header>
    <FollowUpBoard />
    <nav className="flex flex-wrap gap-4" aria-label="Daily destinations"><Link href="/profiles">Profiles</Link><Link href="/leads">Leads</Link><Link href="/schedule">Schedule</Link></nav>
    <details className="rounded-xl border border-border p-4" onToggle={event=>setShowTools(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Conversations, calls &amp; booking tools</summary>{showTools?<div className="mt-4"><LegacyTodayPage /></div>:null}</details>
  </div>;
}

function LegacyTodayPage({ leadsOnly = false }: { leadsOnly?: boolean }) {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callingConfig, setCallingConfig] = useState<CallingConfig>(disabledCallingConfig);
  const [documentReviewCount, setDocumentReviewCount] = useState(0);
  const [scoutAlerts, setScoutAlerts] = useState<ScoutAlertView[]>([]);
  const [hiddenNextSteps, setHiddenNextSteps] = useState<Set<string>>(new Set());
  const [undoBookingIds, setUndoBookingIds] = useState<string[]>([]);
  const [nextStepError, setNextStepError] = useState<string | null>(null);
  const [nextStepBusy, setNextStepBusy] = useState(false);
  const [outreachPlannerOpen, setOutreachPlannerOpen] = useState(
    () => new URLSearchParams(window.location.search).get("section") === "outreach-planner",
  );
  const now = new Date();

  useEffect(() => {
    Promise.all([
      apiGet<any>("/today"),
      apiGet<CallingConfig>("/calls/config").catch(() => disabledCallingConfig),
      apiGet<{ count: number }>("/business-documents/review-count").catch(() => ({ count: 0 })),
    ])
      .then(([d, config, documentReviews]) => {
        setDashboard(d);
        setScoutAlerts(Array.isArray(d.scoutAlerts) ? d.scoutAlerts : []);
        setCallingConfig(config);
        setDocumentReviewCount(documentReviews.count);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  async function refreshToday() {
    try {
      const refreshed = await apiGet<any>("/today");
      setDashboard(refreshed);
      setScoutAlerts(Array.isArray(refreshed.scoutAlerts) ? refreshed.scoutAlerts : []);
      setNextStepError(null);
      return refreshed;
    } catch (cause) {
      setNextStepError("Could not refresh Today. Reload to see the latest saved changes.");
      throw cause;
    }
  }

  useEffect(() => {
    // Other screens and sessions can change reminders while Today remains open.
    const refresh = () => { if (!document.hidden) void refreshToday().catch(() => {}); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (loading || !outreachPlannerOpen) return;
    document.getElementById("route-outreach-planner")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [loading, outreachPlannerOpen]);

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
      setUndoBookingIds(bookingIds);
      await refreshToday();
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
      await refreshToday();
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
      await refreshToday();
    } catch (cause) {
      setNextStepError(cause instanceof Error ? cause.message : "Could not restore the cleared items.");
    } finally {
      setNextStepBusy(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-6xl py-20 text-center text-muted-foreground">Loading Today…</div>;
  if (error || !dashboard) return <div className="mx-auto max-w-6xl"><div className="mt-8 grid gap-3 rounded-xl border border-border bg-card p-6"><p className="font-semibold text-destructive">Could not load Today</p><p className="text-sm text-muted-foreground">{error}</p><Button onClick={() => window.location.reload()}>Try again</Button></div></div>;

  const followUps = coerceFollowUps(dashboard.followUps ?? []);
  const renewals = coerceRenewals(dashboard.renewals ?? []);
  const upcomingEvents = (dashboard.upcomingEvents ?? []).map((event: any) => ({
    ...event,
    startsAt: event.startsAt ? new Date(event.startsAt) : null,
    endsAt: event.endsAt ? new Date(event.endsAt) : null,
  }));
  const nextStepItems = (dashboard.needsFollowUpPlan ?? []).filter((booking: any) => !hiddenNextSteps.has(booking.id));
  if (leadsOnly) {
    const leadStatuses = new Set(["new_lead", "researching", "contact_due", "contacted", "interested", "possible", "unlikely", "quote_sent", "pending_decision"]);
    const leads = nextStepItems.filter((booking: any) => leadStatuses.has(booking.status));
    const leadIds = new Set(leads.map((booking: any) => booking.id));
    return <div className="mx-auto grid max-w-6xl gap-5 text-foreground">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Adventure Zone · Leads</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Lead work queue</h1><p className="mt-1 text-sm text-muted-foreground">One queue, with the selected lead’s next step alongside it.</p></div>
        <Badge variant="secondary">{leads.length} need a next step</Badge>
      </header>
      <p className="text-sm text-muted-foreground">Open leads without a future reminder. Scheduled work remains in Today.</p>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link href="/today">Today</Link></Button><Button asChild variant="ghost" size="sm"><Link href="/profiles">All profiles</Link></Button><Button asChild variant="ghost" size="sm"><Link href="/imports/leads">Import leads</Link></Button></div>
      {nextStepError ? <p role="alert" className="text-sm text-destructive">{nextStepError} <Button variant="outline" size="sm" onClick={() => void refreshToday().catch(() => {})}>Refresh</Button></p> : null}
      <UpcomingDeadlines />
      <DailyWorkspace key="leads" leadsOnly queue={coerceMasterTodayQueue({})} decisions={leads}
        followUps={followUps.filter((item: any) => leadIds.has(item.bookingId))} travelLegs={dashboard.travelLegs ?? []}
        callingEnabled={callingConfig.assistedCallingEnabled} onChanged={refreshToday} onClear={clearNextSteps} onSnooze={snoozeNextSteps} busy={nextStepBusy} />
    </div>;
  }
  const overdueFollowUps = followUps.filter((followUp: any) => classifyBusinessDueDate(followUp.dueAt, now) === "overdue");
  const dueTodayFollowUps = followUps.filter((followUp: any) => classifyBusinessDueDate(followUp.dueAt, now) === "today");
  const actionableFollowUps = [...overdueFollowUps, ...dueTodayFollowUps];
  const overdueCount = overdueFollowUps.length;
  const dueTodayCount = dueTodayFollowUps.length;
  const visibleRouteWarningCount = dashboard.visibleRouteWarningCount ?? 0;
  const urgentScoutAlertCount = scoutAlerts.filter((alert) => alert.severity === "urgent").length;
  const nextEvent = upcomingEvents[0] ?? null;

  return (
    <div className="mx-auto grid max-w-6xl gap-5 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
        <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">Command Center</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatToday(now)}</p>
        </div>
        {actionableFollowUps.length ? <Badge variant="secondary">{overdueCount ? `${overdueCount} overdue · ` : ""}{dueTodayCount} follow-ups due today</Badge> : null}
      </header>

      {nextStepError ? <p className="rounded-lg border border-border p-3 text-sm text-destructive" role="alert">{nextStepError}<Button variant="outline" size="sm" className="ml-3" onClick={() => void refreshToday().catch(() => {})}>Refresh</Button></p> : null}
      {undoBookingIds.length ? <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted p-3" role="status"><span>Cleared from Today.</span><Button variant="outline" size="sm" onClick={undoClear} disabled={nextStepBusy}>Undo</Button></div> : null}
      <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">Conversations, calls &amp; booking work</summary><div className="mt-4"><DailyWorkspace queue={coerceMasterTodayQueue(dashboard.masterQueue)} followUps={followUps} decisions={nextStepItems} travelLegs={dashboard.travelLegs ?? []} callingEnabled={callingConfig.assistedCallingEnabled} onChanged={refreshToday} onClear={clearNextSteps} onSnooze={snoozeNextSteps} busy={nextStepBusy} /></div></details>
      <Button asChild variant="outline" className="w-fit"><Link href="/leads">Review leads and suggested legs</Link></Button>
      <MasterWorkQueue managementOnly queue={coerceMasterTodayQueue(dashboard.masterQueue)} onChanged={refreshToday}/>
      {documentReviewCount > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-accent p-4" aria-label="Document attention">
          <div>
            <h2 className="font-bold text-accent-foreground">{documentReviewCount} {documentReviewCount === 1 ? "document needs" : "documents need"} review</h2>
            <p className="text-sm text-accent-foreground">Document filing work is separate from calls and follow-ups.</p>
          </div>
          <Button asChild variant="outline"><Link href="/business-documents?view=review">Review documents</Link></Button>
        </section>
      ) : null}

      <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer font-semibold">Booking tools</summary><div className="mt-3 grid gap-4">
        {callingConfig.assistedCallingEnabled && actionableFollowUps.length ? (
          <details id="my-work-calls" className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-bold">
              Assisted calling <span className="ml-1 text-muted-foreground">({actionableFollowUps.length})</span>
              {overdueCount ? <span className="ml-2 text-xs font-bold text-destructive">{overdueCount} overdue</span> : null}
              {dueTodayCount ? <span className="ml-2 text-xs font-bold text-primary">{dueTodayCount} today</span> : null}
            </summary>
            <div className="mt-4">
              <CallQueueWorkspace callingConfig={callingConfig} followUps={actionableFollowUps} initialFollowUpId={dashboard.nextCall?.id} refreshToday={async () => { const refreshed = await refreshToday(); const refreshedFollowUps = coerceFollowUps(refreshed.followUps ?? []); const refreshedActionable = refreshedFollowUps.filter((followUp: any) => { const due = classifyBusinessDueDate(followUp.dueAt, new Date()); return due === "overdue" || due === "today"; }); return { followUps: refreshedActionable, followUpTotal: refreshedActionable.length }; }} remainingCount={actionableFollowUps.length} />
            </div>
          </details>
        ) : null}

        <InvoiceContractWorkspaceCard />

      </div></details>

      <ScoutAlertsSection alerts={scoutAlerts} urgentCount={urgentScoutAlertCount} onSnooze={snoozeScoutAlert} onDismiss={dismissScoutAlert} />
      <details id="route-outreach-planner" className="rounded-xl border bg-card p-4" open={outreachPlannerOpen} onToggle={(event) => setOutreachPlannerOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Route outreach and scheduled calls</summary><div className="mt-3">
      <LegCallList callingEnabled={callingConfig.assistedCallingEnabled} followUps={followUps} followUpTotal={dashboard.followUpTotal} now={now} />
      <OutreachPlanner />
      </div></details>

      {visibleRouteWarningCount > 0 ? (
        <section className="rounded-xl border border-border bg-accent p-4" aria-label="Needs attention">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold text-accent-foreground">Route planning needs attention</p><p className="mt-1 text-sm text-accent-foreground">{visibleRouteWarningCount} route warning{visibleRouteWarningCount === 1 ? "" : "s"} need a look.</p></div>
            <Button asChild variant="outline"><Link href="/routes">Review routes</Link></Button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="coming-up-title">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold" id="coming-up-title">Coming up</h2>
          <Button asChild variant="outline" size="sm"><Link href="/schedule">View schedule</Link></Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          {nextEvent ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Next event</p><Link className="mt-1 block text-lg font-bold text-foreground hover:text-primary" href={eventProfileHref({ organizationId: nextEvent.organizationId ?? null, contactId: nextEvent.primaryContactId, bookingId: nextEvent.id }) ?? `/bookings/${nextEvent.id}`}>{nextEvent.name}</Link><BookingOperations operations={nextEvent.operations} /></div>
              {nextEvent.startsAt ? <span className="text-sm font-semibold text-muted-foreground">{formatEventDateRange(nextEvent.startsAt, nextEvent.endsAt)}</span> : null}
            </div>
          ) : <p className="text-sm text-muted-foreground">No upcoming event dates are set.</p>}
          {upcomingEvents.length > 1 ? <p className="mt-3 text-xs font-semibold text-muted-foreground">{upcomingEvents.length - 1} more upcoming event{upcomingEvents.length - 1 === 1 ? "" : "s"}</p> : null}
        </div>
      </section>

      <details id="later-work" className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-lg font-bold">Schedule &amp; renewals</summary>
        <p className="mt-1 text-sm text-muted-foreground">Schedule detail, trips, and renewals are here when you want them.</p>
        <div className="mt-4 grid gap-3">

          {upcomingEvents.length ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Current & upcoming events <span className="ml-1 text-slate-500">({upcomingEvents.length})</span></summary><ul className="mt-2 divide-y divide-slate-100">{upcomingEvents.map((event: any) => {
            const timing = classifyTodayEventTiming(event, now);
            return <li className="flex items-start justify-between gap-3 py-3" key={event.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link className="font-semibold text-slate-950 hover:text-orange-700" href={eventProfileHref({ organizationId: event.organizationId ?? null, contactId: event.primaryContactId, bookingId: event.id }) ?? `/bookings/${event.id}`}>{event.name}</Link><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${timing === "in_progress" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{timing === "in_progress" ? "In progress" : "Upcoming"}</span></div><BookingOperations operations={event.operations} /></div>{event.startsAt ? <span className="whitespace-nowrap text-sm text-slate-600">{formatEventDateRange(event.startsAt, event.endsAt)}</span> : null}</li>;
          })}</ul></details> : null}

          {(dashboard.todayTrips ?? []).length ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Today's trips <span className="ml-1 text-slate-500">({dashboard.todayTrips.length})</span></summary><ul className="mt-3 divide-y divide-slate-100">{dashboard.todayTrips.map((trip: any) => <li className="py-3" key={trip.id}><Link className="font-semibold hover:text-orange-700" href={`/trips/${trip.id}`}>{trip.name}</Link><span className="ml-2 text-sm text-slate-600">{trip.legName ? `${trip.legName} · ` : ""}{trip.stopCount} stops</span></li>)}</ul></details> : null}

        </div>
      </details>

      {(dashboard.renewalTotal ?? renewals.length) > 0 || dashboard.renewalError ? <RenewalsSection error={dashboard.renewalError ?? null} prominentCount={dashboard.renewalProminentCount ?? 0} renewals={renewals} total={dashboard.renewalTotal ?? renewals.length} /> : null}
    </div>
  );
}


