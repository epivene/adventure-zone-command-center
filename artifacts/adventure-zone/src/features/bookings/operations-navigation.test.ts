import { expect, it } from 'vitest';
import { operationsScheduleHref, operationsProfileHref, eventMatchesOperationsSeason, operationsDateKey } from './operations-navigation';
it('keeps the originating schedule filters for the profile return', () => {
  window.history.replaceState(null, '', '/schedule?view=map&season=2027&leg=hulk&status=confirmed');
  const href = operationsProfileHref('/profiles', 'fair', 'booking', new Date('2027-07-04T18:00:00Z'), 'hulk');
  expect(new URLSearchParams(href.split('?')[1]).get('returnTo')).toBe('/schedule?view=map&season=2027&leg=hulk&status=confirmed');
  window.history.replaceState(null, '', '/');
});
it('links to the explicit season and leg without a redundant all status', () => {
  expect(operationsScheduleHref({ season: 2027, legId: 'angel', status: 'all', bookingId: 'fair' })).toBe('/schedule?view=map&season=2027&leg=angel&bookingId=fair');
});
it('cross_year_window_matches_selected_season', () => {
  expect(eventMatchesOperationsSeason({ startsAt: new Date('2026-12-31T18:00:00Z'), endsAt: new Date('2027-01-02T18:00:00Z') }, 2027)).toBe(true);
  expect(eventMatchesOperationsSeason({ startsAt: new Date('2027-01-01T06:30:00Z'), endsAt: null }, 2027)).toBe(false);
  expect(operationsDateKey(new Date('2027-01-01T06:30:00Z'))).toBe('2026-12-31');
  expect(eventMatchesOperationsSeason({ startsAt: null, endsAt: null }, 2027)).toBe(true);
});

it('imported all-day windows preserve calendar days and exclusive ends at New Year and DST', () => {
 const imported = { startsAt: new Date('2027-01-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z'), dateOnly: true };
 expect(eventMatchesOperationsSeason(imported, 2027)).toBe(true);
 expect(eventMatchesOperationsSeason(imported, 2026)).toBe(false);
 expect(operationsDateKey(new Date('2027-03-14T00:00:00Z'), true)).toBe('2027-03-14');
 const reserved = { startsAt: null, endsAt: null, reservedStartsAt: new Date('2026-12-31T00:00:00Z'), reservedEndsAt: new Date('2027-01-01T00:00:00Z'), reservedDateOnly: true, reservedEndExclusive: true };
 expect(eventMatchesOperationsSeason(reserved, 2027)).toBe(false);
});
