import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { operationsFixture } from '@/test/booking-leg-operations-fixture';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/boss-auth-context', () => ({ bossFetch: vi.fn(), bossGet: get, bossPatch: vi.fn() }));
vi.mock('wouter', () => ({ useSearch: () => 'season=2027&bookingId=booking&contactId=contact', useLocation: () => ['/boss/profiles/profile', vi.fn()] }));
vi.mock('@/components/profiles/simple-full-profile', () => ({ SimpleFullProfile: () => <p>Existing profile</p> }));
vi.mock('@/components/office/office-profile-editor', () => ({ OfficeProfileEditor: () => null }));
vi.mock('@/components/profiles/convention-history', () => ({ ConventionHistory: () => null }));
import BossProfilePage from './BossProfilePage';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('mounts the shared facts on the boss profile without owner controls', async () => {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/leg-operations-bookings')) return { bookings: [{ id: 'booking', name: 'Returning fair', status: 'confirmed', seasonYear: 2027, startsAt: null, endsAt: null }] };
    if (path.endsWith('/leg-operations')) return operationsFixture();
    return { profile: { id: 'profile', name: 'Returning fair', contacts: [], bookings: [], notes: [] } };
  });
  render(<BossProfilePage profileId="profile" />);
  expect(await screen.findByText('Angel')).toBeInTheDocument();
  expect(screen.getByText('Existing profile')).toBeInTheDocument();
  expect(screen.getByText('Angelo')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit leg & setup' })).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/boss/bookings/booking/leg-operations');
});
