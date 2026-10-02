import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ search: 'view=map&season=2027&leg=angel', navigate: vi.fn() }));
vi.mock('wouter', () => ({ useSearch: () => state.search, useLocation: () => ['/schedule', state.navigate] }));
vi.mock('@/lib/auth-token', () => ({ apiGet: async () => ({ travelLegs: [{ id: 'angel', name: 'Angel' }] }) }));
vi.mock('./CalendarPage', () => ({ CalendarContent: ({ season, legId }: any) => <p>Calendar {season} {legId}</p> }));
vi.mock('./RoutesPage', () => ({ RoutesContent: ({ season, legId, onSeasonYearChange }: any) => <button onClick={() => onSeasonYearChange(2028)}>Map {season} {legId}</button> }));
import SchedulePage from './SchedulePage';
afterEach(cleanup);
it('url_back_forward_updates_filters and map changes share the parent year', () => {
  const view = render(<SchedulePage />);
  expect(screen.getByRole('button', { name: 'Map 2027 angel' })).toBeInTheDocument();
  state.search = 'season=2026&status=confirmed'; view.rerender(<SchedulePage />);
  expect(screen.getByText('Calendar 2026')).toBeInTheDocument();
  state.search = 'view=map&season=2027&leg=angel'; view.rerender(<SchedulePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Map 2027 angel' }));
  expect(state.navigate).toHaveBeenLastCalledWith('/schedule?view=map&season=2028&leg=angel', { replace: true });
});
