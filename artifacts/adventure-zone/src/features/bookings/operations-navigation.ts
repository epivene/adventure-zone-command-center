import { currentOperationsSeason } from './select-profile-operations-booking';
export function operationsScheduleHref({ season, legId, status, bookingId }: { season: number; legId?: string | null; status?: string; bookingId?: string }): string {
  const query = new URLSearchParams({ view: 'map', season: String(season) });
  if (legId) query.set('leg', legId);
  if (status && status !== 'all') query.set('status', status);
  if (bookingId) query.set('bookingId', bookingId);
  return `/schedule?${query}`;
}
export function operationsDateKey(value: Date, dateOnly = false): string {
  if (dateOnly) return value.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function operationsProfileHref(profileBasePath: string, profileId: string, bookingId: string, publicStartsAt: Date | null, legId?: string | null, dateOnly = false): string {
  const query = new URLSearchParams({ bookingId });
  if (publicStartsAt && Number.isFinite(publicStartsAt.getTime())) query.set('season', operationsDateKey(publicStartsAt, dateOnly).slice(0, 4));
  if (legId) query.set('leg', legId);
  const origin = typeof window === 'undefined' ? '' : window.location.pathname;
  const allowedOrigin = profileBasePath === '/boss/profiles' ? /^\/boss\/schedule\/?$/ : /^\/(schedule|routes)\/?$/;
  if (allowedOrigin.test(origin)) query.set('returnTo', `${origin}${window.location.search}`);
  return `${profileBasePath}/${encodeURIComponent(profileId)}?${query}`;
}
type SeasonWindow = { dateOnly?: boolean; actualDateOnly?: boolean; reservedDateOnly?: boolean; reservedEndExclusive?: boolean; startsAt: Date | null; endsAt: Date | null; reservedStartsAt?: Date | null; reservedEndsAt?: Date | null; actualStartsAt?: Date | null; actualEndsAt?: Date | null };
export function eventMatchesOperationsSeason(event: SeasonWindow, year: number = currentOperationsSeason()): boolean {
  const fields: Array<[Date | null | undefined, boolean | undefined, boolean?]> = [[event.startsAt, event.dateOnly], [event.endsAt, event.dateOnly], [event.reservedStartsAt, event.reservedDateOnly], [event.reservedEndsAt, event.reservedDateOnly, event.reservedEndExclusive], [event.actualStartsAt, event.actualDateOnly ?? event.dateOnly], [event.actualEndsAt, event.actualDateOnly ?? event.dateOnly]];
  const dates = fields.filter(([value]) => value && Number.isFinite(new Date(value).getTime())).map(([value, dateOnly, exclusive]) => { const date = new Date(value!); if (exclusive) date.setTime(date.getTime() - (dateOnly ? 86400000 : 1)); return operationsDateKey(date, dateOnly); }).sort();
  return dates.length === 0 || (dates[0]! <= `${year}-12-31` && dates.at(-1)! >= `${year}-01-01`);
}

export function operationsDateLabel(value: string | null, exclusive = false): string {
 if (!value) return 'Not recorded';
 const parsed = new Date(value), dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
 if (exclusive) parsed.setTime(parsed.getTime() - (dateOnly ? 86400000 : 1));
 return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: dateOnly ? 'UTC' : 'America/Denver', dateStyle: 'medium' }).format(parsed) : 'Not recorded';
}
