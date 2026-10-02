import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { subscribeBookingOperationsChanges } from '@/features/bookings/booking-operations-changes';
const transport = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({ apiGet: transport.get, apiPatch: transport.patch, apiPost: vi.fn() }));
vi.mock('wouter', () => ({ useLocation: () => ['/edit', transport.navigate] }));
import BookingEditPage from './BookingEditPage';
const id = '10000000-0000-4000-8000-000000000001';
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
it.each([true, false])('existing booking editor publishes only a successful saved edit (%s)', async (ok) => {
  transport.get.mockImplementation(async (path: string) => path.endsWith('/package-editor') ? null : { booking: { name: 'Returning fair', city: 'Ogden', region: 'UT', status: 'confirmed', probability: 'definite', latitude: 41.22, longitude: -111.97, startsAt: '2027-07-04T18:00:00Z', endsAt: '2027-07-05T18:00:00Z' }, allTravelLegs: [] });
  transport.patch.mockResolvedValue({ ok, error: 'Save rejected' });
  const listener = vi.fn(), dispose = subscribeBookingOperationsChanges(listener);
  try {
    render(<BookingEditPage bookingId={id} />);
    const save = await screen.findByRole('button', { name: 'Save changes' });
    fireEvent.click(save);
    await waitFor(() => expect(transport.patch).toHaveBeenCalledTimes(1));
    if (ok) { await waitFor(() => expect(listener).toHaveBeenCalledWith(id)); expect(transport.navigate).toHaveBeenCalledWith(`/bookings/${id}`); }
    else { expect(await screen.findByText('Save rejected')).toBeInTheDocument(); expect(listener).not.toHaveBeenCalled(); }
  } finally { dispose(); }
});
