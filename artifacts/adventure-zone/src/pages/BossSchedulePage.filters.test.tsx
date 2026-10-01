import { cleanup,render,screen,fireEvent,waitFor } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
vi.mock('@/components/routes/event-map',()=>({EventMap:({events}:any)=><output data-testid="boss-events">{JSON.stringify(events)}</output>}));
import BossSchedulePage from './BossSchedulePage';
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
function fixture() {
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({legs:[{id:'hulk',name:'Hulk',color:'#123456'}],bookings:[{id:'new-year',name:'January fair',startsAt:'2027-01-02T18:00:00Z',endsAt:'2027-01-03T18:00:00Z',reservedStartsAt:'2026-12-30T18:00:00Z',reservedEndsAt:'2027-01-05T18:00:00Z',status:'confirmed',travelLegId:'hulk'}]}),{headers:{'Content-Type':'application/json'}})));
}
it('boss December scope includes January booking reserved in December',async()=>{
 fixture();window.history.replaceState(null,'','/boss/schedule?season=2026&view=map');render(<BossSchedulePage/>);
 expect(await screen.findByTestId('boss-events')).toHaveTextContent('January fair');
});
it('boss view leg and status filters synchronize the return URL and remove cleared keys',async()=>{
 fixture();window.history.replaceState(null,'','/boss/schedule?season=2027&view=map&bookingId=new-year');render(<BossSchedulePage/>);
 await screen.findByTestId('boss-events');
 fireEvent.change(screen.getByLabelText('Leg'),{target:{value:'hulk'}});
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('leg')).toBe('hulk'));
 fireEvent.change(screen.getByLabelText('Status'),{target:{value:'confirmed'}});
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('status')).toBe('confirmed'));
 fireEvent.click(screen.getByRole('button',{name:'Calendar'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('view')).toBe('calendar'));
 fireEvent.change(screen.getByLabelText('Leg'),{target:{value:''}});fireEvent.change(screen.getByLabelText('Status'),{target:{value:'all'}});
 await waitFor(()=>{expect(new URLSearchParams(window.location.search).has('leg')).toBe(false);expect(new URLSearchParams(window.location.search).has('status')).toBe(false);});
 fireEvent.change(screen.getByLabelText('Season'),{target:{value:'2026'}});
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('season')).toBe('2026'));
 expect(new URLSearchParams(window.location.search).get('bookingId')).toBe('new-year');
 expect(new URLSearchParams(window.location.search).has('leg')).toBe(false);
});
