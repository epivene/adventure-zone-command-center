import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LegOperationsPanel } from './leg-operations-panel';
import { operationsFixture } from '@/test/booking-leg-operations-fixture';
afterEach(cleanup);
it('shows_last_season_source_and_saved_assignment', () => {
  render(<LegOperationsPanel operations={operationsFixture()} role="owner" onRetry={() => {}} />);
  expect(screen.getByText('Angelo')).toBeInTheDocument();
  expect(screen.getByText('Angel')).toBeInTheDocument();
  expect(screen.getByText('Kristy')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Saved booking' })).toHaveAttribute('href', '/bookings/old');
  expect(screen.getByText('Paintball trailer has an overlapping reservation.')).toBeInTheDocument();
});
it('unknown_crew_and_lodging_not_available', () => {
  render(<LegOperationsPanel operations={operationsFixture()} role="owner" onRetry={() => {}} />);
  expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText(/^Ready$|^Available$/)).not.toBeInTheDocument();
  expect(screen.getByText(/Calendar connection needs attention/)).toBeInTheDocument();
});
it('boss_same_facts_fewer_controls', () => {
  render(<LegOperationsPanel operations={operationsFixture()} role="boss" onRetry={() => {}} />);
  expect(screen.getByText('Angel')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit leg & setup' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Saved booking' })).toHaveAttribute('href', '/boss/profiles/profile?bookingId=old&season=2026');
});
it('manager_no_owner_links', () => {
  render(<LegOperationsPanel operations={operationsFixture()} role="manager" onRetry={() => {}} />);
  expect(screen.queryByRole('link', { name: 'Edit leg & setup' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Saved booking' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Review calendar connection' })).not.toBeInTheDocument();
});

it('shows imported date-only public days and the last occupied reserved day', () => {
 const data = operationsFixture();
 data.dates = { state: 'loaded', data: { publicStartsAt: '2027-01-01', publicEndsAt: '2027-01-02', reservedStartsAt: '2026-12-31', reservedEndsAt: '2027-01-03', reservedSource: 'google_calendar', reservedEndExclusive: true } };
 render(<LegOperationsPanel operations={data} role="owner" onRetry={() => {}} />);
 expect(screen.getByText('Public event: Jan 1, 2027 – Jan 2, 2027')).toBeInTheDocument();
 expect(screen.getByText('Reserved: Dec 31, 2026 – Jan 2, 2027')).toBeInTheDocument();
});

it('identifies the dates attached to historical leg evidence', () => {
 render(<LegOperationsPanel operations={operationsFixture()} role="owner" onRetry={() => {}} />);
 expect(screen.getByText('Jul 4, 2026 – Jul 4, 2026')).toBeInTheDocument();
});
