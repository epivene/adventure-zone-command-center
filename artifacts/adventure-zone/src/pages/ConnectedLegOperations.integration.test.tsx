import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { operationsFixture } from '@/test/booking-leg-operations-fixture';
const transport = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({ apiGet: transport.get, apiPatch: transport.patch, apiPost: transport.post, apiFetch: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => ['/bookings/fair/edit', transport.navigate], Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/routes/manager-route-map-shell', () => ({ ManagerRouteMapShell: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/routes/manager-route-map-layers', () => ({ ManagerRouteMapLayers: ({ events }: any) => <p data-testid="map-records">{events.map((event: any) => `${event.name} · ${event.travelLegName}`).join(', ')}</p>, ManagerTripNavigationActions: () => null }));
vi.mock('@/components/routes/trips-section', () => ({ TripsSection: () => null }));
vi.mock('@/components/routes/equipment-handoffs', () => ({ EquipmentHandoffs: () => null }));
import { ProfileLegOperations } from '@/components/bookings/profile-leg-operations';
import { BookingLegOperationsCard } from '@/components/bookings/leg-operations-panel';
import { ownerOperationsClient } from '@/features/bookings/booking-leg-operations-client';
import BookingEditPage from './BookingEditPage';
import { CalendarContent } from './CalendarPage';
import { RoutesContent } from './RoutesPage';
import { DEFAULT_SCHEDULE_DISPLAY_COLORS } from '@/features/calendar/calendar-visual-blocks';
const bookingId = '10000000-0000-4000-8000-000000000001';
const angel = '20000000-0000-4000-8000-000000000001', hulk = '20000000-0000-4000-8000-000000000002';
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
it('shares saved 2027 assignment across profile, booking, existing edit, calendar and map without outbound actions', async () => {
  let legId = angel, legName = 'Angel';
  const legs = [{ id: angel, name: 'Angel', color: '#f97316', sortOrder: 1, archivedAt: null }, { id: hulk, name: 'Hulk', color: '#22c55e', sortOrder: 2, archivedAt: null }];
  const event = () => ({ id: bookingId, organizationId: 'profile', name: 'Returning fair 2027', city: 'Ogden', region: 'UT', latitude: 41.22, longitude: -111.97, startsAt: '2027-07-04T18:00:00Z', endsAt: '2027-07-05T18:00:00Z', status: 'confirmed', probability: 'definite', travelLegId: legId, travelLegName: legName, travelLegColor: '#f97316' });
  transport.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/leg-operations-bookings')) return { bookings: [{ id: bookingId, name: 'Returning fair 2027', status: 'confirmed', seasonYear: 2027, startsAt: event().startsAt, endsAt: event().endsAt }] };
    if (path.endsWith('/leg-operations')) {
      const data = operationsFixture(bookingId);
      data.assignment = { state: 'loaded', data: { assignedLeg: { id: legId, name: legName, archived: false }, suggestion: null, assignmentSource: 'manual' } };
      if (data.history.state === 'loaded') data.history.data.items.unshift({ ...data.history.data.items[0]!, bookingId: 'prior-angel', leg: { id: angel, name: 'Angel', archived: false } });
      return data;
    }
    if (path === '/routes') return { events: [event()], travelLegs: legs, legResources: [] };
    if (path.startsWith('/manager-admin/')) return { legs: [], inspections: [] };
    if (path === '/calendar/display-settings') return DEFAULT_SCHEDULE_DISPLAY_COLORS;
    if (path.startsWith('/calendar?')) return [event()];
    if (path === '/google-workspace/operational-calendar') return { reviews: [], reviewEvents: [] };
    if (path.endsWith('/package-editor')) return null;
    if (path === `/bookings/${bookingId}`) return { booking: event(), allTravelLegs: legs };
    throw new Error(`Unexpected read: ${path}`);
  });
  transport.patch.mockImplementation(async (_path: string, input: { travelLegId: string }) => { legId = input.travelLegId; legName = 'Hulk'; return { ok: true }; });
  render(<>
    <section aria-label="Profile fixture"><ProfileLegOperations profileId="profile" client={ownerOperationsClient} role="owner" search={`season=2027&bookingId=${bookingId}&contactId=contact`} onSearchChange={() => {}} /></section>
    <section aria-label="Booking fixture"><BookingLegOperationsCard bookingId={bookingId} client={ownerOperationsClient} role="owner" /></section>
    <BookingEditPage bookingId={bookingId} />
    <section aria-label="Calendar fixture"><CalendarContent embedded season="2027" /></section>
    <section aria-label="Map fixture"><RoutesContent embedded season="2027" /></section>
  </>);
  const profile = within(screen.getByRole('region', { name: 'Profile fixture' })), booking = within(screen.getByRole('region', { name: 'Booking fixture' }));
  expect(await booking.findByText('Angelo')).toBeInTheDocument();
  expect(await profile.findByText('Angelo')).toBeInTheDocument();
  expect(booking.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2);
  expect(booking.getByText('Paintball trailer has an overlapping reservation.')).toBeInTheDocument();
  const schedule = booking.getByRole('link', { name: 'View schedule & map' });
  expect(schedule).toHaveAttribute('href', `/schedule?view=map&season=2027&leg=${angel}&bookingId=${bookingId}`);
  await screen.findByRole('button', { name: 'Save changes' });
  fireEvent.click(screen.getByRole('button', { name: /^Angel$/ }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Hulk' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(booking.getByText('Hulk')).toBeInTheDocument());
  await waitFor(() => expect(profile.getByText('Hulk')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('map-records')).toHaveTextContent('Returning fair 2027 · Hulk'));
  expect(transport.get.mock.calls.filter(([path]) => path.startsWith('/calendar?')).length).toBeGreaterThanOrEqual(2);
  expect(transport.get.mock.calls.filter(([path]) => path.startsWith('/calendar?')).every(([path]) => path.includes('from=2027-01-01&to=2027-12-31'))).toBe(true);
  fireEvent.click(within(screen.getByRole('region', { name: 'Calendar fixture' })).getByRole('button', { name: 'Upcoming' }));
  const calendarLink = await within(screen.getByRole('region', { name: 'Calendar fixture' })).findByRole('link', { name: /HULK/ });
  expect(calendarLink).toHaveAttribute('href', `/profiles/profile?bookingId=${bookingId}&season=2027&leg=${hulk}`);
  expect(booking.getByText('Angelo')).toBeInTheDocument();
  expect(transport.navigate).toHaveBeenCalledWith(`/bookings/${bookingId}`);
  expect(transport.post).not.toHaveBeenCalled();
  expect(transport.get.mock.calls.some(([path]) => /assistant|sync|import|send/.test(path))).toBe(false);
});
