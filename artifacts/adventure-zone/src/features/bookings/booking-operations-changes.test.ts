import { afterEach, expect, it, vi } from 'vitest';
import { notifyBookingOperationsChanged, subscribeBookingOperationsChanges } from './booking-operations-changes';
const transport = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({ apiPatch: transport.patch, apiPost: transport.post }));
import { updateBookingAction, configureBookingResourcesAction, configureBookingPackagesAction, addSpecialRequestAction, decideSpecialRequestAction } from '@/actions/bookings';
afterEach(() => vi.clearAllMocks());
it('successful_edit_notifies_once and failed_edit_does_not_notify', async () => {
  const listener = vi.fn(), dispose = subscribeBookingOperationsChanges(listener);
  try {
    transport.patch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'Conflict' }).mockRejectedValueOnce(new Error('Offline'));
    const input = {} as Parameters<typeof updateBookingAction>[1];
    await updateBookingAction('fair', input); await updateBookingAction('fair', input); await updateBookingAction('fair', input);
    expect(listener.mock.calls).toEqual([['fair']]);
  } finally { dispose(); }
});
it('package_resource_changes_refresh_warnings and special request decisions invalidate saved reads', async () => {
  const listener = vi.fn(), dispose = subscribeBookingOperationsChanges(listener);
  try {
    transport.post.mockResolvedValue({ ok: true });
    await configureBookingResourcesAction({ bookingId: 'fair', resourceIds: [] });
    await configureBookingPackagesAction({ bookingId: 'fair' } as Parameters<typeof configureBookingPackagesAction>[0]);
    await addSpecialRequestAction({ bookingId: 'fair', description: 'Extra pool', treatment: 'pending' });
    await decideSpecialRequestAction({ specialRequestId: 'request', decision: 'approved', reason: 'Dave approved' });
    expect(listener.mock.calls).toEqual([['fair'], ['fair'], ['fair'], ['*']]);
  } finally { dispose(); }
});
it('dispose_unsubscribes', () => {
  const listener = vi.fn(), dispose = subscribeBookingOperationsChanges(listener);
  dispose(); notifyBookingOperationsChanged('fair'); expect(listener).not.toHaveBeenCalled();
});
