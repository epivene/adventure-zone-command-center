import { expect, it } from 'vitest';
import { BookingLegOperationsService, type OperationsProviders } from './booking-leg-operations-service';
import { OperationsAccessError, type OperationsBaseRecord } from './booking-leg-operations-repository';

const base: OperationsBaseRecord = { booking: { id: 'b', profileId: 'p', name: 'Fair', travelLegId: 'angel', status: 'confirmed', seasonYear: 2027, startsAt: '2027-07-04T16:00:00Z', endsAt: '2027-07-05T02:00:00Z' }, windows: { publicStartsAt: '2027-07-04T16:00:00Z', publicEndsAt: '2027-07-05T02:00:00Z', reservedStartsAt: null, reservedEndsAt: null, reservedSource: null }, assignment: { assignedLeg: { id: 'angel', name: 'Angel', archived: false }, suggestion: { leg: { id: 'kristy', name: 'Kristy', archived: false }, explanation: 'Nearby', source: 'route_score', confidence: 'medium', warning: null }, assignmentSource: 'manual' }, historyCandidates: [] };
function service(overrides: Partial<OperationsProviders> = {}) {
  return new BookingLegOperationsService({ loadBase: async () => base, listProfileBookings: async () => [], loadHistory: async () => [{ bookingId: 'old', profileId: 'p', name: 'Fair', seasonYear: 2026, relation: 'same_profile', leg: { id: 'angel', name: 'Angel', archived: false }, packageNames: ['Adventure Zone'], startsAt: null, endsAt: null, sources: [] }] }, {
    resources: async () => ({ packageNames: ['Adventure Zone'], allocations: [], warnings: [{ id: 'overlap', severity: 'blocking', message: 'Equipment overlap', href: '/bookings/b/edit' }], pendingRequestCount: 1 }),
    route: async () => ({ previous: null, next: null, previousDriveMinutes: null, nextDriveMinutes: null, estimateSource: null, estimatedAt: null }),
    calendar: async () => ({ connectionStatus: 'connected', lastErrorCode: null, pendingReviewCount: 0 }), work: async () => ({ items: [] }), ...overrides,
  });
}
it('suggestion_does_not_allocate', async () => {
  const result = await service().get('b', { kind: 'owner' });
  expect(result?.assignment).toMatchObject({ state: 'loaded', data: { assignedLeg: { id: 'angel' }, suggestion: { leg: { id: 'kristy' } } } });
  expect(result?.resources).toMatchObject({ state: 'loaded', data: { allocations: [], pendingRequestCount: 1 } });
  expect(result?.crew.state).toBe('not_recorded'); expect(result?.lodging.state).toBe('not_recorded');
  expect(JSON.stringify(result)).not.toMatch(/"available"|"ready"/);
});
it('resource_failure_preserves_history_and_status', async () => {
  const result = await service({ resources: async () => { throw Error('Storage offline'); } }).get('b', { kind: 'owner' });
  expect(result?.bookingStatus).toBe('confirmed'); expect(result?.resources.state).toBe('unavailable');
  expect(result?.history).toMatchObject({ state: 'loaded', data: { basis: 'previous_season' } });
});
it('connected_badge_does_not_prove_import_coverage', async () => {
  expect((await service().get('b', { kind: 'owner' }))?.history).toMatchObject({ data: { coverage: 'saved_records_only' } });
});
it('reauthorization_is_visible', async () => {
  const result = await service({ calendar: async () => ({ connectionStatus: 'reauthorization_required', lastErrorCode: 'GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED', pendingReviewCount: 2 }) }).get('b', { kind: 'owner' });
  expect(result?.calendar).toMatchObject({ data: { lastErrorCode: 'GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED' } });
  expect(result?.history).toMatchObject({ data: { coverage: 'review_pending' } });
});
it('denied_work_is_not_partial_fallback', async () => {
  const result = await service({ work: async () => { throw Error('must not load owner tasks'); } }).get('b', { kind: 'boss' });
  expect(result?.work.state).toBe('restricted');
  expect(result?.history.state).toBe('loaded');
});
it('manager_cannot_read_other_leg', async () => {
  await expect(service().get('b', { kind: 'manager', legId: 'hulk' })).rejects.toMatchObject({ status: 403 });
});
it('does not hide access errors as an empty partial section', async () => {
  await expect(service({ resources: async () => { throw new OperationsAccessError(403); } }).get('b', { kind: 'owner' })).rejects.toMatchObject({ status: 403 });
});
