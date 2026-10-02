import type { BookingLegOperations, OperationsSection } from '@workspace/api-zod';
import {useRef,type ReactNode} from 'react';
import type { OperationsReadClient } from '@/features/bookings/booking-leg-operations-client';
import { useBookingLegOperations } from '@/features/bookings/use-booking-leg-operations';
import { operationsScheduleHref, operationsManagerHref, operationsDateLabel as date } from '@/features/bookings/operations-navigation';
import { EventPlanEditor } from '@/components/leg-planning/event-plan-editor';

type Role = 'owner' | 'boss' | 'manager';
function Section<T>({ title, value, children }: { title: string; value: OperationsSection<T>; children: (data: T) => ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-slate-200 p-3"><h3 className="font-semibold">{title}</h3>{value.state === 'loaded' ? <div className="mt-2 grid gap-2 text-sm">{children(value.data)}</div> : <div className="mt-2 text-sm"><p className="font-medium text-slate-600">{value.state === 'not_recorded' ? 'Not recorded' : value.state === 'restricted' ? 'Office-managed' : 'Unavailable'}</p><p className="mt-1 text-slate-600">{value.message}</p></div>}</section>;
}
export function LegOperationsPanel({ operations: o, role, onRetry }: { operations: BookingLegOperations; role: Role; onRetry: () => void }) {
  const capability=useRef<string|null>(null);if(o.planning?.state==='loaded')capability.current=o.bookingId;
  const ownerHref = o.seasonYear === null ? '/schedule?view=map' : operationsScheduleHref({ season: o.seasonYear, bookingId: o.bookingId, legId: o.assignment.state === 'loaded' ? o.assignment.data.assignedLeg?.id : null });
  const managerHref = operationsManagerHref({bookingId:o.bookingId,season:o.seasonYear,legId:o.assignment.state==='loaded'?o.assignment.data.assignedLeg?.id:null});
  const scheduleHref = role === 'boss' ? ownerHref.replace('/schedule', '/boss/schedule') : role === 'manager' ? managerHref : ownerHref;
  return <section aria-label="Leg & Operations" className="grid min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-xl font-bold">Leg &amp; Operations</h2><p className="mt-1 text-sm text-slate-600">{o.seasonYear ?? 'Year not recorded'} · Booking: {o.bookingStatus.replaceAll('_', ' ')}</p></div><div className="flex flex-wrap gap-2 text-sm"><a className="button-secondary" href={scheduleHref}>View schedule &amp; map</a>{role === 'owner' ? <a className="button-secondary" href={`/bookings/${o.bookingId}/edit`}>Edit leg &amp; setup</a> : null}</div></header>
    <p className="text-sm text-slate-600">Saved assignments and suggestions still need crew, equipment and travel checks.</p>
    {role !== 'manager' && o.assignment.state === 'loaded' && o.assignment.data.assignedLeg ? <a className="button-secondary justify-self-start" href={managerHref}>Manager operations</a> : null}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      <Section title="Previous season" value={o.history}>{h => <>
        {h.basis === 'none' ? <p>No matched historical booking in the saved records. Calendar history may still need reconciliation.</p> : h.items.map(item => <div key={`${item.bookingId}:${item.leg?.id ?? ''}`} className="grid gap-1 border-b border-slate-100 pb-2 last:border-0">
          <p className="font-semibold">{item.seasonYear} · {item.name}{h.basis === 'last_known' ? ' · Last known visit' : ''}</p>
          <p><span>{item.leg?.name ?? 'Leg not recorded'}</span>{item.leg?.archived ? <span className="ml-2 text-slate-500">Historical manager</span> : null}</p>
          <p className="text-slate-500">{date(item.startsAt)} – {date(item.endsAt)}</p>
          <p>{item.packageNames.join(' + ') || 'Package not recorded'}</p>
          {item.relation === 'event_family' ? <p className="text-amber-800">Related event-family evidence; review the match.</p> : null}
          <div className="flex flex-wrap gap-3">{item.sources.filter(source => role !== 'manager' || source.href.startsWith('https://')).map(source => <a key={source.href} className="break-all text-blue-700 underline" href={role === 'boss' && source.href.startsWith('/bookings/') ? `/boss/profiles/${item.profileId}?bookingId=${item.bookingId}&season=${item.seasonYear}` : source.href}>{source.label}</a>)}</div>
        </div>)}
        <p className="text-xs text-slate-500">{h.coverage === 'review_pending' ? 'Calendar matches need review.' : 'Saved booking history; calendar reconciliation is not verified.'}</p>
        {h.hasMore && h.historyHref && role === 'owner' ? <a className="text-blue-700 underline" href={h.historyHref}>Review remaining history</a> : null}
      </>}</Section>
      <Section title="This year's leg" value={o.assignment}>{a => <>
        <p><span className="font-semibold">{a.assignedLeg ? 'Assigned' : 'Needs leg'}</span>: <span>{a.assignedLeg?.name ?? 'No saved assignment'}</span></p>
        {a.assignedLeg?.archived ? <p className="text-amber-800">This assigned leg is archived; review it.</p> : null}
        {a.suggestion ? <div><p><span className="font-semibold">Suggested</span>: <span>{a.suggestion.leg.name}</span></p><p className="mt-1 text-slate-600">{a.suggestion.explanation}</p><p className="text-xs text-slate-500">{a.suggestion.confidence} confidence · {a.suggestion.source.replaceAll('_', ' ')}</p>{a.suggestion.warning ? <p className="text-amber-800">{a.suggestion.warning.replaceAll('_', ' ')}</p> : null}</div> : null}
      </>}</Section>
      <Section title="Dates & reserved window" value={o.dates}>{d => <><p>Public event: {date(d.publicStartsAt)} – {date(d.publicEndsAt)}</p><p>Reserved: {date(d.reservedStartsAt)} – {date(d.reservedEndsAt, d.reservedEndExclusive)}</p>{!d.reservedStartsAt || !d.reservedEndsAt ? <p className="text-amber-800">Needs details: verify travel, setup and teardown days.</p> : null}<p className="text-xs text-slate-500">Dates shown in Mountain Time. Reserved window source: {d.reservedSource ?? 'Not recorded'}.</p></>}</Section>
      <Section title="Packages & equipment" value={o.resources}>{r => <>
        <p>Selected packages: {r.packageNames.join(' + ') || 'Not recorded'}</p>
        <p className="font-medium">Allocated equipment</p>{r.allocations.length ? <ul className="list-inside list-disc">{r.allocations.map(item => <li key={item.id}>{item.name} · {item.status}</li>)}</ul> : <p>Not recorded. Package selection does not allocate a physical set.</p>}
        {r.warnings.map(w => <p key={w.id} className={w.severity === 'blocking' ? 'text-rose-800' : 'text-amber-800'}>{w.message}{role === 'owner' ? <> <a className="underline" href={w.href}>Review</a></> : null}</p>)}
        {r.pendingRequestCount ? <p className="text-amber-800">Needs approval: {r.pendingRequestCount} special {r.pendingRequestCount === 1 ? 'request' : 'requests'}.</p> : null}
      </>}</Section>
      <Section title="Crew" value={o.crew}>{c => <>{c.assignments.length ? c.assignments.map(item => <p key={item.id}>{item.name} · {item.role}</p>) : <p>No verified current-season assignment recorded.</p>}{c.history.map((item, i) => <p key={i}>History: {item.name} · {item.role} · {item.seasonYear ?? 'Year unknown'}</p>)}</>}</Section>
      <Section title="Vehicles, campers & lodging" value={o.lodging}>{l => <>{l.items.length ? l.items.map(item => <p key={item.id}>{item.kind}: {item.description}</p>) : <p>No verified lodging details recorded.</p>}</>}</Section>
      <Section title="Surrounding route" value={o.route}>{r => <>
        <p>Previous: {r.previous?.name ?? 'Not recorded'}{r.previousDriveMinutes !== null ? ` · ${Math.round(r.previousDriveMinutes / 60 * 10) / 10}h stored travel` : ' · Travel time not recorded'}</p>
        <p>Next: {r.next?.name ?? 'Not recorded'}{r.nextDriveMinutes !== null ? ` · ${Math.round(r.nextDriveMinutes / 60 * 10) / 10}h stored travel` : ' · Travel time not recorded'}</p>
        <p className="text-xs text-slate-500">{r.estimateSource ?? 'No verified route estimate recorded.'}{r.estimatedAt ? ` · Saved ${date(r.estimatedAt)}` : ''}</p>
      </>}</Section>
      <Section title="Next action" value={o.work}>{w => <>{w.items.length ? w.items.map(item => <div key={item.id}><p className="font-semibold">{item.title}</p><p>{item.nextAction}</p><p className="text-xs text-slate-500">Work status: {item.status.replaceAll('_', ' ')}</p></div>) : <p>Review missing crew, equipment, lodging and travel details.</p>}</>}</Section>
    </div>
    {role !== 'manager' ? <Section title="Calendar connection" value={o.calendar}>{c => <><p>{c.connectionStatus !== 'connected' || c.lastErrorCode ? 'Calendar connection needs attention.' : 'Calendar connection saved as connected; history coverage is not verified.'}</p>{c.pendingReviewCount ? <p>{c.pendingReviewCount} calendar {c.pendingReviewCount === 1 ? 'match needs' : 'matches need'} review.</p> : null}{role === 'owner' ? <a className="text-blue-700 underline" href="/settings/google-workspace">Review calendar connection</a> : null}</>}</Section> : null}
    {capability.current===o.bookingId ? <details><summary className="cursor-pointer font-bold">Operating plan · {o.planning?.state==='loaded'?o.planning.data.readiness.overall.replaceAll('_', ' '):'unavailable'}</summary><div className="mt-3"><EventPlanEditor bookingId={o.bookingId} role={role} onCommitted={onRetry}/></div></details> : o.planning ? <Section title="Operating plan" value={o.planning}>{() => null}</Section> : null}
    {Object.values(o).some(value => typeof value === 'object' && value !== null && 'state' in value && value.state === 'unavailable') ? <button type="button" className="button-secondary justify-self-start" onClick={onRetry}>Retry unavailable details</button> : null}
  </section>;
}
export function BookingLegOperationsCard({ bookingId, client, role }: { bookingId: string; client: OperationsReadClient; role: Role }) {
  const result = useBookingLegOperations(bookingId, client);
  if (result.error && !result.data) return <section className="rounded-xl border p-4"><h2 className="font-bold">Leg &amp; Operations</h2><p role="alert" className="mt-2 text-sm text-rose-700">Operations details are unavailable.</p><button type="button" className="button-secondary mt-2" onClick={() => void result.reload()}>Retry operations</button></section>;
  if (!result.data) return <p className="rounded-xl border p-4 text-sm text-slate-500">Loading leg &amp; operations…</p>;
  return <>{result.error?<p role="alert">Operations refresh failed. Showing previously saved details; your open draft is retained.</p>:null}<LegOperationsPanel operations={result.data} role={role} onRetry={() => void result.reload()} /></>;
}
