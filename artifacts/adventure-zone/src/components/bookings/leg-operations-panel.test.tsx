import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LegOperationsPanel } from './leg-operations-panel';
import { operationsFixture } from '@/test/booking-leg-operations-fixture';
afterEach(cleanup);
it.each(['owner', 'boss'] as const)('labels an unavailable calendar section for %s and permits retry', role => {
  const data = operationsFixture(), retry = vi.fn();
  data.calendar = { state: 'unavailable', message: 'Calendar connection could not be loaded. Retry to check the saved records.' };
  render(<LegOperationsPanel operations={data} role={role} onRetry={retry} />);
  const calendar = within(screen.getByRole('heading', { name: 'Calendar connection' }).closest('section')!);
  expect(calendar.getByText('Unavailable')).toBeInTheDocument();
  expect(calendar.getByText(/Calendar connection could not be loaded/)).toBeInTheDocument();
  expect(screen.queryByText(/saved as connected/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable details' }));
  expect(retry).toHaveBeenCalledOnce();
});
it('keeps office calendar error details hidden from managers', () => {
  const data = operationsFixture();
  data.calendar = { state: 'restricted', message: 'Office calendar connection is restricted.' };
  render(<LegOperationsPanel operations={data} role="manager" onRetry={() => {}} />);
  expect(screen.queryByRole('heading', { name: 'Calendar connection' })).not.toBeInTheDocument();
  expect(screen.queryByText('Office calendar connection is restricted.')).not.toBeInTheDocument();
});
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

it.each(["boss","manager"] as const)("shows read-only date evidence without owner repair controls for %s",role=>{
 const data=operationsFixture();
 if(data.dates.state!=="loaded")throw new Error("Fixture dates required");
 data.dates.data.dateProvenance={rawPublic:{start:"2026-01-01T00:00:00Z",end:"9999-12-31T00:00:00Z"},rawReservation:{start:null,end:null},publicWindow:null,reservationWindow:null,publicEndExclusive:false,reservationEndExclusive:false,evidenceState:"needs_review",reviewReasons:["INCOMPLETE_PUBLIC_WINDOW"],endpointEvidence:[{field:"public_start",kind:"sales_milestone",value:"2026-01-01T00:00:00Z",semantics:"instant",revision:1,sourceRef:{type:"act_source_record",id:"sales-source",revision:"saved-v1"}}]};
 render(<LegOperationsPanel operations={data} role={role} onRetry={()=>{}}/>);
 expect(screen.getByText("Date evidence: needs_review")).toBeInTheDocument();
 expect(screen.getByText(/sales_milestone/)).toBeInTheDocument();
 expect(screen.queryByRole("link",{name:"Review booking dates"})).not.toBeInTheDocument();
});
