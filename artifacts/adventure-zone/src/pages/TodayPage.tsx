import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { FollowUpList } from "@/components/today/follow-up-list";
import { CallQueueWorkspace } from "@/components/today/call-queue-workspace";
import { NextCallCard, eventProfileHref } from "@/components/today/next-call-card";
import { BookingOperations } from "@/components/today/booking-operations";
import { RenewalsSection } from "@/components/today/renewals-section";
import { NeedsAttention } from "@/components/today/needs-attention";
import { ProfileDetailSheet, type ProfileSheetTarget } from "@/components/profiles/profile-detail-sheet";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(value);
}

type CallingConfig = { assistedCallingEnabled: boolean; voicemailLauncherUrl: string | null };
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
  const [profileTarget, setProfileTarget] = useState<ProfileSheetTarget | null>(null);
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
    setProfileTarget({ profileId: decodeURIComponent(match[1]), contactId: linkParams.get("contactId") ?? undefined, bookingId: linkParams.get("bookingId") ?? undefined });
  }

  if (loading) return <div className="mx-auto max-w-5xl py-20 text-center text-slate-500">Loading Today…</div>;
  if (error || !dashboard) return <div className="mx-auto max-w-5xl"><div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-6"><p className="font-semibold text-rose-800">Could not load Today</p><p className="mt-1 text-sm text-rose-700">{error}</p></div></div>;

  const followUps = coerceFollowUps(dashboard.followUps ?? []);
  const renewals = coerceRenewals(dashboard.renewals ?? []);
  const upcomingEvents = (dashboard.upcomingEvents ?? []).map((e: any) => ({ ...e, startsAt: e.startsAt ? new Date(e.startsAt) : null }));
  const firstNewLead = (dashboard.needsFollowUpPlan ?? []).find((b: any) => b.status === "new_lead");
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

      {(dashboard.needsFollowUpPlan ?? []).length ? <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-bold">Follow-up planning ({dashboard.needsFollowUpPlan.length})</summary><ul className="mt-4 grid gap-3">{dashboard.needsFollowUpPlan.map((booking: any) => <li key={booking.id}><Link className="font-semibold text-slate-950 hover:text-orange-700" href={eventProfileHref({ organizationId: booking.organizationId ?? null, contactId: booking.primaryContactId, bookingId: booking.id, mode: booking.status === "new_lead" ? "prospect" : undefined }) ?? `/bookings/${booking.id}`}>{booking.name}</Link><BookingOperations operations={booking.operations} /></li>)}</ul></details> : null}

      {(dashboard.todayTrips ?? []).length ? <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-bold">Today’s trips ({dashboard.todayTrips.length})</summary><ul className="mt-4 grid gap-2">{dashboard.todayTrips.map((trip: any) => <li key={trip.id}><Link className="font-semibold hover:text-orange-700" href={`/trips/${trip.id}`}>{trip.name}</Link><span className="ml-2 text-sm text-slate-600">{trip.legName ? `${trip.legName} · ` : ""}{trip.stopCount} stops</span></li>)}</ul></details> : null}

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-bold">Renewals & secondary activity</summary><div className="mt-4"><RenewalsSection error={dashboard.renewalError ?? null} prominentCount={dashboard.renewalProminentCount ?? 0} renewals={renewals} total={dashboard.renewalTotal ?? renewals.length} /></div></details>

      <ProfileDetailSheet open={Boolean(profileTarget)} onOpenChange={(open) => { if (!open) setProfileTarget(null); }} target={profileTarget} />
    </div>
  );
}
