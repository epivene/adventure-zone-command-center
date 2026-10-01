import type { BookingLegOperations, CalendarView, OperationsSection, OperationsViewer, ResourcesView, RouteView, WorkView } from '@workspace/api-zod';
import { selectOperationsHistory } from './booking-leg-operations-history';
import { OperationsAccessError, type BookingLegOperationsRepository, type OperationsBaseRecord } from './booking-leg-operations-repository';

export type OperationsProviders = {
  resources: (id: string, base: OperationsBaseRecord) => Promise<ResourcesView>;
  route: (id: string, base: OperationsBaseRecord) => Promise<RouteView>;
  calendar: (id: string) => Promise<CalendarView>;
  work: (id: string, base: OperationsBaseRecord) => Promise<WorkView>;
};
const loaded = <T>(data: T): OperationsSection<T> => ({ state: 'loaded', data });
async function readSection<T>(name: string, load: () => Promise<T>): Promise<OperationsSection<T>> {
  try { return loaded(await load()); } catch (error) {
    if (error instanceof OperationsAccessError) throw error;
    return { state: 'unavailable', message: `${name} could not be loaded. Retry to check the saved records.` };
  }
}
export class BookingLegOperationsService {
  constructor(private readonly repository: Pick<BookingLegOperationsRepository, 'loadBase' | 'loadHistory' | 'listProfileBookings'>, private readonly providers: OperationsProviders) {}
  listProfileBookings(profileId: string, viewer: OperationsViewer) { return this.repository.listProfileBookings(profileId, viewer); }

  async get(bookingId: string, viewer: OperationsViewer): Promise<BookingLegOperations | null> {
    const base = await this.repository.loadBase(bookingId, viewer);
    if (!base) return null;
    if (viewer.kind === 'manager' && base.booking.travelLegId !== viewer.legId) throw new OperationsAccessError(403);
    const [history, resources, route, calendar, work] = await Promise.all([
      readSection('History', async () => selectOperationsHistory(base.booking.seasonYear, await this.repository.loadHistory(bookingId, viewer))),
      readSection('Packages and equipment', () => this.providers.resources(bookingId, base)),
      readSection('Route', () => this.providers.route(bookingId, base)),
      viewer.kind === 'manager' ? Promise.resolve<OperationsSection<CalendarView>>({ state: 'restricted', message: 'Calendar connection details are managed by the office.' }) : readSection('Calendar connection', () => this.providers.calendar(bookingId)),
      viewer.kind === 'owner' ? readSection('Next action', () => this.providers.work(bookingId, base)) : Promise.resolve<OperationsSection<WorkView>>({ state: 'restricted', message: 'Office work items are managed in the owner workspace.' }),
    ]);
    if (viewer.kind === 'manager' && resources.state === 'loaded') {
      resources.data.warnings = resources.data.warnings.map((warning, index) => ({ id: `equipment-warning-${index}`, severity: warning.severity, message: 'An equipment or package conflict needs office review.', href: '/manager/operations' }));
    }
    if (history.state === 'loaded' && calendar.state === 'loaded' && calendar.data.pendingReviewCount > 0) history.data.coverage = 'review_pending';
    if (viewer.kind === 'manager' && history.state === 'loaded') {
      history.data.historyHref = null;
      history.data.items = history.data.items.map(item => ({ ...item, sources: item.sources.filter(source => source.href.startsWith('https://')) }));
    }
    return {
      bookingId, profileId: base.booking.profileId, seasonYear: base.booking.seasonYear, bookingStatus: base.booking.status,
      assignment: loaded(base.assignment), dates: loaded(base.windows), history, resources, route, calendar, work,
      crew: { state: 'not_recorded', message: 'Current-season crew assignments are not recorded here. Crew work history does not confirm availability.' },
      lodging: { state: 'not_recorded', message: 'Vehicle, camper and lodging needs have not been recorded for this booking.' },
    };
  }
}
