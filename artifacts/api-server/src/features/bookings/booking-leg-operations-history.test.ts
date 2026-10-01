import { describe, expect, it } from 'vitest';
import { selectOperationsHistory } from './booking-leg-operations-history';
import type { OperationsHistoryItem } from '@workspace/api-zod';

function item(bookingId: string, seasonYear: number | null, name = 'Angel', legId = name): OperationsHistoryItem {
  return { bookingId, profileId: 'profile', name: 'Town fair', seasonYear, relation: 'same_profile', leg: { id: legId, name, archived: name === 'Angelo' || name === 'JR' }, packageNames: ['Adventure Zone'], startsAt: seasonYear ? `${seasonYear}-07-04T16:00:00Z` : null, endsAt: seasonYear ? `${seasonYear}-07-05T02:00:00Z` : null, sources: [{ label: 'Saved booking', href: `/bookings/${bookingId}` }] };
}

describe('historical leg evidence', () => {
  it('keeps_archived_identity_and_multiple_legs', () => {
    const result = selectOperationsHistory(2027, [item('a', 2026, 'Angelo'), item('b', 2026)]);
    expect(result.items.map(x => x.leg?.name)).toEqual(['Angelo', 'Angel']);
    expect(result.items[0].leg?.archived).toBe(true);
  });
  it('does_not_merge_Jeremy_JR', () => {
    const result = selectOperationsHistory(2027, [item('a', 2026, 'Jeremy (tentative)', 'jeremy'), item('b', 2026, 'JR', 'jr')]);
    expect(result.items.map(x => x.leg?.id)).toEqual(['jeremy', 'jr']);
  });
  it('previous_season_before_older_last_known', () => {
    expect(selectOperationsHistory(2027, [item('old', 2024), item('last', 2026)]).items.map(x => x.bookingId)).toEqual(['last']);
    const fallback = selectOperationsHistory(2027, [item('old', 2024), item('last', 2025)]);
    expect(fallback.basis).toBe('last_known');
    expect(fallback.items[0].seasonYear).toBe(2025);
  });
  it('ambiguous_family_shows_all_evidence', () => {
    const result = selectOperationsHistory(2027, [item('a', 2026), { ...item('b', 2026, 'Mikey'), relation: 'event_family' }]);
    expect(result.items).toHaveLength(2);
    expect(result.items[1].relation).toBe('event_family');
  });
  it('undated_is_not_current_season', () => {
    expect(selectOperationsHistory(2027, [item('undated', null), item('future', 2028)]).basis).toBe('none');
    expect(selectOperationsHistory(null, [item('a', 2026)]).items).toEqual([]);
  });
  it('package_mirrors_do_not_duplicate_booking', () => {
    const result = selectOperationsHistory(2027, [item('a', 2026), { ...item('a', 2026), packageNames: ['Pirates'], sources: [{ label: 'Calendar', href: 'https://calendar.google.com/calendar/event?eid=test' }] }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].packageNames).toEqual(['Adventure Zone', 'Pirates']);
    expect(result.items[0].sources).toHaveLength(2);
  });
  it('limits_history_without_claiming_complete_coverage', () => {
    const result = selectOperationsHistory(2027, Array.from({ length: 23 }, (_, i) => item(String(i).padStart(2, '0'), 2026)));
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.coverage).toBe('saved_records_only');
  });
});
