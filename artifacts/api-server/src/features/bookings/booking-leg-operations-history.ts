import type { HistoryView, OperationsHistoryItem } from '@workspace/api-zod';

/** All-day public dates are identified by the saved import marker and UTC-midnight representation. */
export function isImportedCalendarDate(value: Date | string | null, imported: boolean): boolean {
  return Boolean(imported && value && new Date(value).toISOString().endsWith('T00:00:00.000Z'));
}
export function operationsDateKey(value: Date | string, dateOnly = false): string {
  const date = new Date(value);
  if (dateOnly || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return date.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  return `${(part('year') ?? '').padStart(4,'0')}-${part('month')}-${part('day')}`;
}
export function operationsReadDate(value: Date | string | null, dateOnly = false): string | null {
  return value == null ? null : dateOnly ? operationsDateKey(value, true) : new Date(value).toISOString();
}
export function operationsSeason(value: Date | string | null, dateOnly = false): number | null {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return Number(operationsDateKey(value, dateOnly).slice(0, 4));
}

export function selectOperationsHistory(targetSeason: number | null, candidates: OperationsHistoryItem[]): HistoryView {
  const grouped = new Map<string, OperationsHistoryItem>();
  for (const item of candidates) {
    if (targetSeason === null || item.seasonYear === null || item.seasonYear >= targetSeason) continue;
    const key = `${item.bookingId}:${item.leg?.id ?? ''}`;
    const previous = grouped.get(key);
    grouped.set(key, previous ? {
      ...previous,
      packageNames: [...new Set([...previous.packageNames, ...item.packageNames])].sort(),
      sources: [...new Map([...previous.sources, ...item.sources].map(source => [source.href, source])).values()],
    } : { ...item, packageNames: [...new Set(item.packageNames)].sort(), sources: [...item.sources] });
  }
  const all = [...grouped.values()];
  const newest = all.length ? Math.max(...all.map(item => item.seasonYear!)) : null;
  const season = all.some(item => item.seasonYear === targetSeason! - 1) ? targetSeason! - 1 : newest;
  const matches = all.filter(item => item.seasonYear === season).sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.bookingId.localeCompare(b.bookingId));
  return { basis: season === null ? 'none' : season === targetSeason! - 1 ? 'previous_season' : 'last_known', items: matches.slice(0, 20), hasMore: matches.length > 20, historyHref: candidates[0] ? `/profiles/${encodeURIComponent(candidates[0].profileId)}` : null, coverage: 'saved_records_only' };
}
