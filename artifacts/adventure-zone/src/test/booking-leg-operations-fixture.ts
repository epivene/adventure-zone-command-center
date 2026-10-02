import type { BookingLegOperations } from '@workspace/api-zod';
export function operationsFixture(id = 'booking'): BookingLegOperations {
  return { bookingId: id, profileId: 'profile', seasonYear: 2027, bookingStatus: 'confirmed',
    assignment: { state: 'loaded', data: { assignedLeg: { id: 'angel', name: 'Angel', archived: false }, assignmentSource: 'manual', suggestion: { leg: { id: 'kristy', name: 'Kristy', archived: false }, source: 'route_score', explanation: 'Nearby event', confidence: 'medium', warning: null } } },
    history: { state: 'loaded', data: { basis: 'previous_season', items: [{ bookingId: 'old', profileId: 'profile', name: 'Fair 2026', seasonYear: 2026, relation: 'same_profile', leg: { id: 'angelo', name: 'Angelo', archived: true }, packageNames: ['Adventure Zone'], startsAt: '2026-07-04T16:00:00Z', endsAt: '2026-07-05T02:00:00Z', sources: [{ label: 'Saved booking', href: '/bookings/old' }] }], hasMore: false, historyHref: '/profiles/profile', coverage: 'saved_records_only' } },
    dates: { state: 'loaded', data: { publicStartsAt: '2027-07-04T16:00:00Z', publicEndsAt: '2027-07-05T02:00:00Z', reservedStartsAt: '2027-07-02T16:00:00Z', reservedEndsAt: '2027-07-07T16:00:00Z', reservedSource: 'calendar' } },
    resources: { state: 'loaded', data: { packageNames: ['Adventure Zone'], allocations: [], warnings: [{ id: 'overlap', severity: 'blocking', message: 'Paintball trailer has an overlapping reservation.', href: '/bookings/booking/edit' }], pendingRequestCount: 1 } },
    route: { state: 'loaded', data: { previous: null, next: null, previousDriveMinutes: null, nextDriveMinutes: null, estimateSource: null, estimatedAt: null } },
    crew: { state: 'not_recorded', message: 'Current-season crew assignments are not recorded.' }, lodging: { state: 'not_recorded', message: 'Camper and lodging needs have not been recorded.' },
    calendar: { state: 'loaded', data: { connectionStatus: 'reauthorization_required', lastErrorCode: 'GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED', pendingReviewCount: 1 } },
    work: { state: 'loaded', data: { items: [{ id: 'work', title: 'Check equipment', status: 'blocked', nextAction: 'Ask Dave about the trailer', href: '/profiles/profile?season=2027' }] } },
  };
}
