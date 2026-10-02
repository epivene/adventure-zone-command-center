import type { db as Database } from '@/db/client';
import type { SqlQuery } from '@/features/chatgpt-connection/contracts';
import { PostgresGoogleConnectionRepository } from '@/features/google-workspace/google-connection-repository';
import { BookingWorkRepository } from '@/features/booking-work/repository';
import { createBookingOperationsSummaryProvider } from './booking-operations-summary';
import { BookingLegOperationsRepository } from './booking-leg-operations-repository';
import { BookingLegOperationsService } from './booking-leg-operations-service';

const iso = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
export function createBookingLegOperationsService(sql: SqlQuery, database: typeof Database): BookingLegOperationsService {
  return new BookingLegOperationsService(new BookingLegOperationsRepository(sql), {
    async resources(id) {
      const summary = await createBookingOperationsSummaryProvider(database).getForBooking(id);
      const { rows } = await sql.query(`SELECT r.id,r.name,r.status FROM booking_resource_assignments a JOIN resources r ON r.id=a.resource_id WHERE a.booking_id=$1 ORDER BY r.name,r.id`, [id]);
      return { packageNames: summary.packageNames, allocations: rows.map(row => ({ id: row.id, name: row.name, status: row.status, quantity: 1 })), warnings: summary.warnings, pendingRequestCount: summary.pendingRequestCount };
    },
    async route(id, base) {
      const { rows } = await sql.query(`SELECT b.id,b.name,coalesce(w.starts_at,b.starts_at) AS starts_at,coalesce(w.ends_at,b.ends_at,b.starts_at) AS ends_at
        FROM bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id
        WHERE b.travel_leg_id=$1 AND b.id<>$2 AND b.status IN ('confirmed','completed','contract_received','deposit_received','invoice_sent') ORDER BY starts_at,id`, [base.booking.travelLegId, id]);
      const start = base.windows.reservedStartsAt ?? base.booking.startsAt, end = base.windows.reservedEndsAt ?? base.booking.endsAt ?? start;
      const previous = start ? rows.filter(row => row.ends_at && new Date(row.ends_at).getTime() <= new Date(start).getTime()).sort((a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime())[0] : null;
      const next = end ? rows.find(row => row.starts_at && new Date(row.starts_at).getTime() >= new Date(end).getTime()) : null;
      const decision = (await sql.query('SELECT previous_stop_drive_minutes,next_stop_drive_minutes,updated_at FROM booking_leg_assignments WHERE booking_id=$1 AND (assigned_leg_id=$2 OR suggested_leg_id=$2)', [id, base.booking.travelLegId])).rows[0];
      const stop = (row: typeof previous) => row ? { bookingId: row.id, name: row.name, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at) } : null;
      return { previous: stop(previous), next: stop(next), previousDriveMinutes: decision?.previous_stop_drive_minutes ?? null, nextDriveMinutes: decision?.next_stop_drive_minutes ?? null, estimateSource: decision ? 'Saved leg decision; route may have changed' : null, estimatedAt: iso(decision?.updated_at) };
    },
    async calendar(id) {
      const repository = new PostgresGoogleConnectionRepository({ pool: sql });
      const connection = await repository.getByRole('operational_calendar');
      const { rows } = await sql.query(`SELECT count(*)::int AS count FROM google_operational_calendar_reviews WHERE booking_id=$1 AND state='pending'`, [id]);
      return { connectionStatus: connection?.status ?? 'disconnected', lastErrorCode: connection?.lastErrorCode ?? null, pendingReviewCount: rows[0]?.count ?? 0 };
    },
    async work(_id, base) {
      if (!base.booking.profileId || base.booking.seasonYear === null) return { items: [] };
      const page = await new BookingWorkRepository(sql).list({ profileId: base.booking.profileId, eventYear: base.booking.seasonYear, limit: 50 });
      return { items: page.items.filter(item => !['completed', 'cancelled'].includes(item.status) && (!item.bookingId || item.bookingId === base.booking.id)).map(item => ({ id: item.id, title: item.title, status: item.status, nextAction: item.nextAction, href: `/profiles/${base.booking.profileId}?bookingId=${base.booking.id}&season=${base.booking.seasonYear}` })) };
    },
  });
}
