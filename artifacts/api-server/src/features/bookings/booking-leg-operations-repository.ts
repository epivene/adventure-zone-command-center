import type { AssignmentView, DateWindows, OperationsBookingOption, OperationsHistoryItem, OperationsViewer } from '@workspace/api-zod';
import type { SqlQuery } from '@/features/chatgpt-connection/contracts';
import { operationsSeason, operationsReadDate, isImportedCalendarDate } from './booking-leg-operations-history';

export class OperationsAccessError extends Error {
  constructor(public readonly status: number, message = 'This booking is outside your access') { super(message); }
}
export type OperationsBaseRecord = {
  booking: OperationsBookingOption & { profileId: string | null; travelLegId: string | null };
  windows: DateWindows;
  assignment: AssignmentView;
  historyCandidates: OperationsHistoryItem[];
};
const iso = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
const leg = (id: string | null, name: string | null, archivedAt: unknown) => id && name ? { id, name, archived: archivedAt != null } : null;

export class BookingLegOperationsRepository {
  constructor(private readonly db: SqlQuery) {}

  async loadBase(bookingId: string, viewer: OperationsViewer): Promise<OperationsBaseRecord | null> {
    const { rows } = await this.db.query(`SELECT b.id,b.organization_id,b.name,b.status,b.travel_leg_id,b.starts_at,b.ends_at,
      EXISTS(SELECT 1 FROM google_operational_calendar_links c WHERE c.booking_id=b.id AND c.last_app_snapshot->>'imported'='true') AS imported_dates,
      l.name AS leg_name,l.archived_at AS leg_archived_at,w.starts_at AS reserved_starts_at,w.ends_at AS reserved_ends_at,w.source AS reserved_source,
      a.source AS assignment_source,a.explanation,a.confidence,a.warning,a.suggested_leg_id,
      s.name AS suggested_leg_name,s.archived_at AS suggested_leg_archived_at
      FROM bookings b LEFT JOIN travel_legs l ON l.id=b.travel_leg_id
      LEFT JOIN booking_operational_windows w ON w.booking_id=b.id
      LEFT JOIN booking_leg_assignments a ON a.booking_id=b.id
      LEFT JOIN travel_legs s ON s.id=a.suggested_leg_id WHERE b.id=$1`, [bookingId]);
    const row = rows[0];
    if (!row) return null;
    if (viewer.kind === 'manager' && row.travel_leg_id !== viewer.legId) throw new OperationsAccessError(403);
    const suggestedLeg = leg(row.suggested_leg_id, row.suggested_leg_name, row.suggested_leg_archived_at);
    return {
      booking: { id: row.id, name: row.name, status: row.status, profileId: row.organization_id, travelLegId: row.travel_leg_id, seasonYear: operationsSeason(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), startsAt: operationsReadDate(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), endsAt: operationsReadDate(row.ends_at, isImportedCalendarDate(row.ends_at, row.imported_dates)) },
      windows: { publicStartsAt: operationsReadDate(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), publicEndsAt: operationsReadDate(row.ends_at, isImportedCalendarDate(row.ends_at, row.imported_dates)), reservedStartsAt: operationsReadDate(row.reserved_starts_at, row.reserved_source === 'google_calendar'), reservedEndsAt: operationsReadDate(row.reserved_ends_at, row.reserved_source === 'google_calendar'), reservedEndExclusive: row.reserved_source === 'google_calendar', reservedSource: row.reserved_source ?? null },
      assignment: {
        assignedLeg: leg(row.travel_leg_id, row.leg_name, row.leg_archived_at), assignmentSource: row.assignment_source ?? (row.travel_leg_id ? 'existing_assignment' : null),
        suggestion: suggestedLeg && !suggestedLeg.archived && row.assignment_source !== 'manual' ? { leg: suggestedLeg, explanation: row.explanation ?? '', source: row.assignment_source ?? 'needs_review', confidence: row.confidence ?? 'low', warning: row.warning ?? null } : null,
      },
      historyCandidates: [],
    };
  }

  async listProfileBookings(profileId: string, viewer: OperationsViewer): Promise<OperationsBookingOption[]> {
    if (viewer.kind === 'manager') throw new OperationsAccessError(403);
    const profile = await this.db.query('SELECT id FROM organizations WHERE id=$1', [profileId]);
    if (!profile.rows.length) throw new OperationsAccessError(404, 'Profile not found');
    const { rows } = await this.db.query(`SELECT b.id,b.name,b.status,b.starts_at,b.ends_at,EXISTS(SELECT 1 FROM google_operational_calendar_links c WHERE c.booking_id=b.id AND c.last_app_snapshot->>'imported'='true') AS imported_dates FROM bookings b WHERE b.organization_id=$1 ORDER BY b.starts_at DESC NULLS LAST,b.id`, [profileId]);
    return rows.map(row => ({ id: row.id, name: row.name, status: row.status, seasonYear: operationsSeason(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), startsAt: operationsReadDate(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), endsAt: operationsReadDate(row.ends_at, isImportedCalendarDate(row.ends_at, row.imported_dates)) }));
  }

  async loadHistory(bookingId: string, viewer: OperationsViewer): Promise<OperationsHistoryItem[]> {
    const base = await this.loadBase(bookingId, viewer);
    if (!base?.booking.profileId) return [];
    const { rows } = await this.db.query(`SELECT b.id,b.organization_id,b.name,b.starts_at,b.ends_at,b.travel_leg_id,l.name AS leg_name,l.archived_at,
      EXISTS(SELECT 1 FROM google_operational_calendar_links c WHERE c.booking_id=b.id AND c.last_app_snapshot->>'imported'='true') AS imported_dates,
      coalesce((SELECT jsonb_agg(DISTINCT p.name) FROM booking_package_selections ps JOIN package_templates p ON p.id=ps.package_template_id WHERE ps.booking_id=b.id),'[]'::jsonb) AS packages,
      coalesce((SELECT jsonb_agg(jsonb_build_object('calendarId',c.calendar_id,'googleEventId',c.google_event_id)) FROM google_operational_calendar_links c WHERE c.booking_id=b.id),'[]'::jsonb) AS calendar_sources
      FROM bookings b LEFT JOIN travel_legs l ON l.id=b.travel_leg_id
      WHERE b.id<>$1 AND (b.organization_id=$2 OR b.organization_id IN (
        SELECT member.organization_id FROM event_family_members member WHERE member.family_id IN (SELECT family_id FROM event_family_members WHERE organization_id=$2)))
      AND b.status IN ('confirmed','completed','contract_received','deposit_received','invoice_sent')
      AND ($3::uuid IS NULL OR b.travel_leg_id=$3::uuid)
      ORDER BY b.starts_at DESC NULLS LAST,b.id`, [bookingId, base.booking.profileId, viewer.kind === 'manager' ? viewer.legId : null]);
    return rows.map(row => ({
      bookingId: row.id, profileId: row.organization_id, name: row.name, seasonYear: operationsSeason(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), relation: row.organization_id === base.booking.profileId ? 'same_profile' : 'event_family',
      leg: leg(row.travel_leg_id, row.leg_name, row.archived_at), packageNames: (row.packages as string[]).sort(), startsAt: operationsReadDate(row.starts_at, isImportedCalendarDate(row.starts_at, row.imported_dates)), endsAt: operationsReadDate(row.ends_at, isImportedCalendarDate(row.ends_at, row.imported_dates)),
      sources: [{ label: 'Saved booking', href: `/bookings/${row.id}` }, ...(row.calendar_sources as Array<{ googleEventId: string; calendarId: string }>).map(source => ({ label: 'Calendar source', href: `https://calendar.google.com/calendar/event?eid=${Buffer.from(`${source.googleEventId} ${source.calendarId}`).toString('base64url')}` }))],
    }));
  }
}
