import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProfileLegOperations } from './profile-leg-operations';
import { operationsFixture } from '@/test/booking-leg-operations-fixture';
import { selectProfileOperationsBooking } from '@/features/bookings/select-profile-operations-booking';
import type { OperationsBookingOption } from '@workspace/api-zod';
afterEach(cleanup);
const options: OperationsBookingOption[] = ['one', 'two'].map(id => ({ id, name: id === 'one' ? 'First fair' : 'Second fair', status: 'confirmed', seasonYear: 2027, startsAt: null, endsAt: null }));
it('multiple_bookings_require_choice', async () => {
  render(<ProfileLegOperations profileId="profile" role="owner" search="?season=2027" onSearchChange={() => {}} client={{ getBooking: async id => operationsFixture(id), listProfileBookings: async () => options }} />);
  expect(await screen.findByText('Choose the booking to plan.')).toBeInTheDocument();
  expect(screen.queryByText('Angel')).not.toBeInTheDocument();
});
it('requested_booking_wrong_profile_is_rejected', () => {
  expect(selectProfileOperationsBooking(options, 2027, 'other-profile-booking')).toMatchObject({ kind: 'invalid' });
  expect(selectProfileOperationsBooking(options, 2026, 'one')).toMatchObject({ kind: 'invalid' });
});
it('preserves unrelated query filters when selecting a booking', async () => {
  let changed = '';
  render(<ProfileLegOperations profileId="profile" role="owner" search="?season=2027&contactId=contact&returnTo=%2Fschedule" onSearchChange={value => { changed = value; }} client={{ getBooking: async id => operationsFixture(id), listProfileBookings: async () => options }} />);
  fireEvent.change(await screen.findByLabelText('Operations booking'), { target: { value: 'two' } });
  expect(new URLSearchParams(changed).get('contactId')).toBe('contact');
  expect(new URLSearchParams(changed).get('bookingId')).toBe('two');
});

it('distinguishes repeated booking names using their public dates', async () => {
 const choices = options.map((item, i) => ({ ...item, name: 'County Fair', startsAt: i ? '2027-09-01' : '2027-07-04' }));
 render(<ProfileLegOperations profileId="profile" role="owner" search="?season=2027" onSearchChange={() => {}} client={{ getBooking: async id => operationsFixture(id), listProfileBookings: async () => choices }} />);
 expect(await screen.findByRole('option', { name: 'County Fair · Jul 4, 2027' })).toBeInTheDocument();
 expect(screen.getByRole('option', { name: 'County Fair · Sep 1, 2027' })).toBeInTheDocument();
});
