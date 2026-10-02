import { expect, it } from 'vitest';
import { operationsHistoryItemSchema, operationsBookingOptionSchema } from './booking-leg-operations';

it('rejects executable and protocol-relative history source links', () => {
  const row = { bookingId: 'a', profileId: 'p', name: 'Fair', seasonYear: 2026, relation: 'same_profile', leg: null, packageNames: [], startsAt: null, endsAt: null };
  for (const href of ['javascript:alert(1)', '//evil.test', '/\\evil.test']) {
    expect(operationsHistoryItemSchema.safeParse({ ...row, sources: [{ label: 'Source', href }] }).success).toBe(false);
  }
  expect(operationsHistoryItemSchema.safeParse({ ...row, sources: [{ label: 'Booking', href: '/bookings/a' }] }).success).toBe(true);
});
it('keeps an undated booking season unknown', () => {
  const option = operationsBookingOptionSchema.parse({ id: 'b', name: 'Fair', status: 'confirmed', seasonYear: null, startsAt: null, endsAt: null });
  expect(option.seasonYear).toBeNull();
});
