import { operationsDateLabel } from '@/features/bookings/operations-navigation';
import { useEffect, useState } from 'react';
import type { OperationsBookingOption } from '@workspace/api-zod';
import type { OperationsReadClient } from '@/features/bookings/booking-leg-operations-client';
import { currentOperationsSeason, selectProfileOperationsBooking } from '@/features/bookings/select-profile-operations-booking';
import { BookingLegOperationsCard } from './leg-operations-panel';
import { useBookingOperationsRevision } from '@/features/bookings/booking-operations-changes';
export function ProfileLegOperations({ profileId, client, role, search, onSearchChange }: { profileId: string; client: OperationsReadClient; role: 'owner' | 'boss'; search: string; onSearchChange: (search: string) => void }) {
  const [savedOptions, setOptions] = useState<{profileId:string;client:OperationsReadClient;items:OperationsBookingOption[]} | null>(null);
  const options=savedOptions?.profileId===profileId&&savedOptions.client===client?savedOptions.items:null;
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const changes = useBookingOperationsRevision();
  useEffect(() => {
    let active = true; setError(false);
    client.listProfileBookings(profileId).then(value => { if (active) setOptions({profileId,client,items:value}); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [profileId, client, revision, changes]);
  const params = new URLSearchParams(search);
  const requestedSeason = params.get('season');
  const season = requestedSeason && /^\d{4}$/.test(requestedSeason) ? Number(requestedSeason) : currentOperationsSeason();
  const selection = selectProfileOperationsBooking(options ?? [], season, params.get('bookingId'));
  const years = [...new Set([currentOperationsSeason(), currentOperationsSeason() + 1, season, ...(options ?? []).flatMap(item => item.seasonYear === null ? [] : [item.seasonYear])])].sort((a, b) => b - a);
  function change(value: { season?: number; bookingId?: string }) {
    const query = new URLSearchParams(search);
    query.set('season', String(value.season ?? season));
    if (value.bookingId) query.set('bookingId', value.bookingId); else query.delete('bookingId');
    onSearchChange(query.toString());
  }
  return <section aria-label="Booking operations selection" className="grid min-w-0 gap-3">
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3"><label className="grid gap-1 text-sm font-semibold">Operations season<select aria-label="Operations season" value={season} onChange={event => change({ season: Number(event.target.value) })}>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></label>
      {options ? <label className="grid min-w-0 flex-1 gap-1 text-sm font-semibold">Operations booking<select aria-label="Operations booking" value={selection.kind === 'selected' ? selection.booking.id : ''} onChange={event => change({ bookingId: event.target.value })}><option value="">Choose a booking</option>{options.filter(item => item.seasonYear === season).map(item => <option key={item.id} value={item.id}>{item.name} · {item.startsAt ? operationsDateLabel(item.startsAt) : 'Dates not recorded'}</option>)}{options.some(item => item.seasonYear === null) ? <optgroup label="Year not recorded">{options.filter(item => item.seasonYear === null).map(item => <option key={item.id} value={item.id}>{item.name} · Year not recorded</option>)}</optgroup> : null}</select></label> : null}
    </div>
    {error ? <div className="rounded-xl border p-3 text-sm"><p role="alert">Booking operations could not be loaded.</p><button className="button-secondary mt-2" type="button" onClick={() => setRevision(value => value + 1)}>Retry booking list</button></div> : !options ? <p className="text-sm text-slate-500">Loading saved bookings…</p> : selection.kind === 'selected' ? <BookingLegOperationsCard key={selection.booking.id} bookingId={selection.booking.id} role={role} client={client} /> : <p className="rounded-xl border bg-white p-3 text-sm text-slate-600">{selection.kind === 'invalid' ? 'The requested booking does not match this profile and season. Choose the booking to plan.' : selection.kind === 'choose' ? 'Choose the booking to plan.' : `No saved booking for ${season}. Create a booking to plan this season; undated bookings remain separate.`}</p>}
  </section>;
}
