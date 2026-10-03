import { operationalReadReviewReminder } from "../operational-review-policy";
import { z } from "zod";
import {
  activeConnection,
  ConnectionError,
  inputHash,
  requireConnectionScope,
  type ConnectionDatabase,
  type ConnectionPrincipal,
} from "./contracts";

export const scheduleSections = [
  "legs",
  "bookings",
  "leg_suggestions",
  "holds",
  "leg_seasons",
  "operating_plans",
] as const;
export const routeSections = ["trips", "stops", "segments", "anchors"] as const;
export const resourceSections = [
  "packages",
  "resources",
  "booking_packages",
  "booking_resources",
  "trip_resources",
  "crew_history",
  "demand",
  "resource_tags",
  "resource_attributions",
  "crew_roster",
  "crew_memberships",
  "crew_availability",
  "package_sets",
] as const;
const allSections = [
  ...scheduleSections,
  ...routeSections,
  ...resourceSections,
] as const;
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a real calendar date");
export const operationalInput = z
  .object({
    section: z.enum(allSections),
    eventYear: z.number().int().min(1900).max(2200).optional(),
    dateFrom: day.optional(),
    dateTo: day.optional(),
    dateMode: z.enum(["all", "undated"]).optional(),
    legId: z.string().uuid().optional(),
    bookingId: z.string().uuid().optional(),
    tripId: z.string().uuid().optional(),
    resourceId: z.string().uuid().optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .superRefine((a, c) => {
    if (
      !!a.dateFrom !== !!a.dateTo ||
      (a.dateFrom && a.dateTo && a.dateFrom > a.dateTo) ||
      (a.eventYear !== undefined && a.dateFrom) ||
      (a.dateMode === "undated" && (a.dateFrom || a.eventYear !== undefined))
    )
      c.addIssue({
        code: "custom",
        message:
          "Use eventYear OR an inclusive dateFrom/dateTo range OR dateMode=undated.",
      });
  });
type Input = z.infer<typeof operationalInput>;
type Filter = "legId" | "bookingId" | "tripId" | "resourceId";
type Query = {
  select: string;
  from: string;
  filters: Partial<Record<Filter, string>>;
  start?: string;
  end?: string;
  order?: string;
};
const dateJoin = " LEFT JOIN LATERAL (SELECT booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at) AS date_provenance OFFSET 0) d ON true";
const effectiveStart = "CASE WHEN w.booking_id IS NOT NULL THEN (d.date_provenance#>>'{reservationWindow,start}')::timestamptz ELSE (d.date_provenance#>>'{publicWindow,start}')::timestamptz END";
const effectiveEnd = "CASE WHEN w.booking_id IS NOT NULL THEN (d.date_provenance#>>'{reservationWindow,end}')::timestamptz - CASE WHEN (d.date_provenance->>'reservationEndExclusive')::boolean THEN interval '1 millisecond' ELSE interval '0 milliseconds' END ELSE (d.date_provenance#>>'{publicWindow,end}')::timestamptz - CASE WHEN (d.date_provenance->>'publicEndExclusive')::boolean THEN interval '1 millisecond' ELSE interval '0 milliseconds' END END";
const bookingWindow = {
  start: effectiveStart,
  end: effectiveEnd,
};
const bookingJoins =
  " JOIN bookings b ON b.id=a.booking_id LEFT JOIN booking_operational_windows w ON w.booking_id=b.id" + dateJoin;
const bookingFilters = { bookingId: "b.id", legId: "b.travel_leg_id" };
const bookingColumns =
  "b.id AS booking_id,b.organization_id AS profile_id,b.name AS booking_name,b.status AS booking_status,b.travel_leg_id AS leg_id,b.starts_at,b.ends_at,w.starts_at AS operational_starts_at,w.ends_at AS operational_ends_at,d.date_provenance";
const tripWindow = { start: "t.start_date", end: "t.end_date" };
const tripFilters = { tripId: "t.id", legId: "t.travel_leg_id" };
// All SQL identifiers and expressions are static; only values come from tool input.
const queries: Record<Input["section"], Query> = {
  leg_seasons: {
    select: "(substr(md5(a.leg_id::text||':'||a.season_year::text),1,12)||'5'||substr(md5(a.leg_id::text||':'||a.season_year::text),14,3)||'8'||substr(md5(a.leg_id::text||':'||a.season_year::text),18,15))::uuid AS id,a.leg_id,a.season_year,a.revision,a.updated_at,a.payload->>'leadership' AS leadership,a.payload->>'managerName' AS manager_name,a.payload->'managerWorkerId' AS manager_worker_id,a.payload->'workerIds' AS worker_ids,a.payload->>'baseAddress' AS base_address,a.payload->'transportResourceIds' AS transport_resource_ids",
    from: "leg_season_plans a",
    filters: { legId: "a.leg_id" },
    start: "make_date(a.season_year,1,1)::timestamp AT TIME ZONE 'America/Denver'",
    end: "(make_date(a.season_year+1,1,1)::timestamp AT TIME ZONE 'America/Denver')-interval '1 microsecond'",
  },
  operating_plans: {
    select: "a.booking_id AS id,a.booking_id,b.organization_id AS profile_id,b.name AS booking_name,a.leg_id,a.revision,a.draft,a.committed,a.invalidation_reasons,a.updated_at",
    from: "leg_event_plans a JOIN bookings b ON b.id=a.booking_id",
    filters: { bookingId: "a.booking_id", legId: "a.leg_id" },
    start: "make_date(COALESCE((a.committed->>'seasonYear')::integer,(a.draft->>'seasonYear')::integer),1,1)::timestamp AT TIME ZONE 'America/Denver'",
    end: "(make_date(COALESCE((a.committed->>'seasonYear')::integer,(a.draft->>'seasonYear')::integer)+1,1,1)::timestamp AT TIME ZONE 'America/Denver')-interval '1 microsecond'",
  },
  crew_roster: {
    select: "a.id,a.name,a.city,a.region,a.updated_at",
    from: "crew_workers a",
    filters: {},
  },
  crew_memberships: {
    select: "(substr(md5(a.worker_id::text||':'||a.leg_id::text),1,12)||'5'||substr(md5(a.worker_id::text||':'||a.leg_id::text),14,3)||'8'||substr(md5(a.worker_id::text||':'||a.leg_id::text),18,15))::uuid AS id,a.worker_id,w.name AS worker_name,a.leg_id,a.created_at",
    from: "crew_worker_leg_memberships a JOIN crew_workers w ON w.id=a.worker_id",
    filters: { legId: "a.leg_id" },
  },
  crew_availability: {
    select: "a.id,a.worker_id,w.name AS worker_name,a.starts_at,a.ends_at,a.state,a.revision,a.payload->'window' AS source_window,a.payload->'source' AS source",
    from: "crew_availability a JOIN crew_workers w ON w.id=a.worker_id",
    filters: {},
    start: "a.starts_at",
    end: "a.ends_at",
  },
  package_sets: {
    select: "a.id,a.package_id,p.name AS package_name,a.revision,a.payload->>'name' AS name,a.payload->>'classification' AS classification,a.payload->>'state' AS state,a.payload->>'verifiedAt' AS verified_at,a.payload->'requirements' AS requirements,a.payload->'source' AS source,COALESCE((SELECT jsonb_agg(m.resource_id ORDER BY m.resource_id) FROM package_set_members m WHERE m.set_id=a.id),'[]'::jsonb) AS resource_ids",
    from: "package_sets a JOIN package_templates p ON p.id=a.package_id",
    filters: {},
  },
  legs: {
    select:
      "a.id,a.name,a.color,a.sort_order,a.archived_at,a.base_address,a.default_vehicle_name,a.updated_at",
    from: "travel_legs a",
    filters: { legId: "a.id" },
    order: "a.sort_order",
  },
  bookings: {
    select: `b.id,b.organization_id AS profile_id,b.name,b.status,b.probability,b.travel_leg_id AS leg_id,b.venue_name,b.address_1,b.city,b.region,b.postal_code,b.latitude,b.longitude,b.starts_at,b.ends_at,b.physical_attraction_total,b.attraction_total_approval_reason,b.updated_at,w.starts_at AS operational_starts_at,w.ends_at AS operational_ends_at,w.source AS operational_window_source,d.date_provenance,CASE WHEN b.travel_leg_id IS NULL THEN 'unassigned' ELSE 'assigned' END AS assignment_state`,
    from: "bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id" + dateJoin,
    filters: bookingFilters,
    ...bookingWindow,
  },
  leg_suggestions: {
    select: `a.id,${bookingColumns},a.assigned_leg_id,a.suggested_leg_id,a.source,a.explanation,a.warning,a.previous_stop_drive_minutes,a.next_stop_drive_minutes,a.confidence,a.updated_at`,
    from: "booking_leg_assignments a" + bookingJoins,
    filters: bookingFilters,
    ...bookingWindow,
  },
  holds: {
    select:
      "a.id,a.booking_id,b.organization_id AS profile_id,a.leg_id,a.event_starts_on::text,a.event_ends_on::text,a.starts_on::text,a.ends_on::text,a.quantities,a.resource_ids,a.state,a.expires_at,a.ended_at,a.revision,(a.expires_at<=now()) AS expired_by_clock",
    from: "outreach_holds a JOIN bookings b ON b.id=a.booking_id",
    filters: { bookingId: "a.booking_id", legId: "a.leg_id" },
    start: "a.starts_on::timestamp AT TIME ZONE 'America/Denver'",
    end: "(a.ends_on+1)::timestamp AT TIME ZONE 'America/Denver'",
  },
  trips: {
    select:
      "t.id,t.travel_leg_id AS leg_id,t.name,t.start_date,t.end_date,t.start_label,t.start_latitude,t.start_longitude,t.end_label,t.end_latitude,t.end_longitude,t.vehicle_name,t.route_confirmed_at,t.updated_at",
    from: "trips t",
    filters: tripFilters,
    ...tripWindow,
  },
  stops: {
    select: `a.id,a.trip_id,a.sort_order,t.travel_leg_id AS trip_leg_id,${bookingColumns},b.venue_name,b.address_1,b.city,b.region,b.latitude,b.longitude`,
    from: "trip_stops a JOIN trips t ON t.id=a.trip_id" + bookingJoins,
    filters: { ...tripFilters, bookingId: "b.id" },
    ...tripWindow,
    order: "a.sort_order",
  },
  segments: {
    select:
      "a.id,a.trip_id,a.sequence,a.from_key,a.to_key,a.from_label,a.to_label,a.miles,a.minutes,a.source,a.estimated_at,a.override_miles,a.override_minutes,a.updated_at",
    from: "trip_segments a JOIN trips t ON t.id=a.trip_id",
    filters: tripFilters,
    ...tripWindow,
    order: "a.sequence",
  },
  anchors: {
    select:
      "a.id,a.leg_id,a.resource_id,a.direction,a.latitude,a.longitude,a.available_at,a.valid_until,a.source,a.reason,a.revision,a.recorded_at,a.revoked_at",
    from: "outreach_route_anchors a",
    filters: { legId: "a.leg_id", resourceId: "a.resource_id" },
    start: "a.available_at",
    end: "a.valid_until",
  },
  packages: {
    select:
      "a.id,a.code,a.name,a.base_attraction_count,a.normal_capacity,a.temporary_unavailable_quantity,a.active,a.updated_at",
    from: "package_templates a",
    filters: {},
  },
  resources: {
    select:
      "a.id,a.code,a.name,a.category,a.counts_as_attraction,a.movable,a.normal_travel_leg_id,a.setup_minutes,a.teardown_minutes,a.minimum_transfer_minutes,a.status,a.updated_at",
    from: "resources a",
    filters: { resourceId: "a.id", legId: "a.normal_travel_leg_id" },
  },
  booking_packages: {
    select: `a.id,${bookingColumns},a.package_template_id`,
    from: "booking_package_selections a" + bookingJoins,
    filters: bookingFilters,
    ...bookingWindow,
  },
  booking_resources: {
    select: `a.id,${bookingColumns},a.resource_id,a.attribution_source,a.updated_at`,
    from: "booking_resource_assignments a" + bookingJoins,
    filters: { ...bookingFilters, resourceId: "a.resource_id" },
    ...bookingWindow,
  },
  trip_resources: {
    select:
      "a.id,a.trip_id,a.resource_id,t.travel_leg_id AS leg_id,t.start_date,t.end_date",
    from: "trip_resource_assignments a JOIN trips t ON t.id=a.trip_id",
    filters: { ...tripFilters, resourceId: "a.resource_id" },
    ...tripWindow,
  },
  crew_history: {
    select:
      "a.id,a.worker_id,a.leg_id,a.booking_id,a.trip_id,a.role,a.started_at,a.ended_at,a.updated_at",
    from: "crew_work_history a",
    filters: {
      legId: "a.leg_id",
      bookingId: "a.booking_id",
      tripId: "a.trip_id",
    },
    start: "a.started_at",
    end: "COALESCE(a.ended_at,'infinity'::timestamptz)",
  },
  demand: {
    select: `a.booking_id AS id,${bookingColumns},a.quantities,a.resource_ids,a.revision,a.updated_at`,
    from: "outreach_booking_demand a" + bookingJoins,
    filters: bookingFilters,
    ...bookingWindow,
  },
  resource_tags: {
    select: "a.id,a.resource_id,a.package_template_id",
    from: "resource_package_tags a",
    filters: { resourceId: "a.resource_id" },
  },
  resource_attributions: {
    select:
      "a.id,a.booking_resource_assignment_id,a.package_template_id,r.booking_id,r.resource_id",
    from: "booking_resource_package_attributions a JOIN booking_resource_assignments r ON r.id=a.booking_resource_assignment_id JOIN bookings b ON b.id=r.booking_id LEFT JOIN booking_operational_windows w ON w.booking_id=b.id" + dateJoin,
    filters: {
      bookingId: "r.booking_id",
      resourceId: "r.resource_id",
      legId: "b.travel_leg_id",
    },
    ...bookingWindow,
  },
};
const limitations = [
  operationalReadReviewReminder,
  "availability=available means this storage read succeeded; complete=true applies only to this section. Neither establishes route, crew or equipment availability.",
  "Season plans, roster membership, availability and operating-plan drafts are separate facts. Membership is not confirmed availability; an unverified set or draft is not a commitment. Operating-plan date filters use its committed season, falling back to draft season, not actual event or crew windows.",
  "Saved records only; not a complete availability or conflict verdict. Follow every nextCursor and inspect adjacent dates before assigning resources.",
  "Booking status, leg assignment, package selection and resource allocation are separate facts. Missing deposit evidence does not release signed commitments.",
  "Operational windows are stored overall windows, not separate verified arrival/setup/teardown/departure times. Coordinates are saved venue/trip points, not verified load-in points.",
  "Package capacity and resource status are not free inventory. Consider booking allocations, trip allocations and holds together; do not double-count a resource assigned to both a trip and its booking.",
  "Date filters use stored booking/operational/trip windows, not calculated equipment buffers. Widen the range for setup, teardown and transfers; current resource status is not a historical maintenance calendar.",
  "Crew work history is not a future crew availability roster. Route anchors and minimum transfer minutes are not a verified equipment movement itinerary.",
  "This does not fetch Google Calendar-only events or refresh routing estimates. Reconcile calendar-only events and duplicate mirrors separately.",
];
const camel = (s: string) =>
  s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
function project(row: Record<string, any>) {
  const out: Record<string, any> = {},
    omittedFields: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (key === "_order") continue;
    const name = camel(key);
    if (typeof value === "string" && value.length > 2000) {
      out[name] = value.slice(0, 2000);
      omittedFields.push(name);
    } else if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      JSON.stringify(value).length > 12000
    ) {
      out[name] = null;
      omittedFields.push(name);
    } else out[name] = value instanceof Date ? value.toISOString() : value;
  }
  if (out.profileId) out.profileHref = `/profiles/${out.profileId}`;
  if (out.bookingId) out.bookingHref = `/bookings/${out.bookingId}`;
  if (out.tripId) out.tripHref = `/trips/${out.tripId}`;
  if (omittedFields.length) out.truncatedFields = omittedFields;
  return out;
}
export async function readOperational(
  db: ConnectionDatabase,
  p: ConnectionPrincipal,
  raw: unknown,
) {
  requireConnectionScope(p, "crm:read");
  await activeConnection(db, p);
  const parsed = operationalInput.safeParse(raw);
  if (!parsed.success)
    throw new ConnectionError("CONNECTION_INVALID_OPERATIONAL_FILTER");
  const a = parsed.data,
    q = queries[a.section];
  const from = a.eventYear ? `${a.eventYear}-01-01` : a.dateFrom;
  const to = a.eventYear ? `${a.eventYear}-12-31` : a.dateTo;
  if ((from || a.dateMode === "undated") && !q.start)
    throw new ConnectionError("CONNECTION_INVALID_OPERATIONAL_FILTER");
  const params: unknown[] = [],
    where: string[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return "$" + params.length;
  };
  for (const field of ["legId", "bookingId", "tripId", "resourceId"] as const)
    if (a[field]) {
      if (!q.filters[field])
        throw new ConnectionError("CONNECTION_INVALID_OPERATIONAL_FILTER");
      where.push(`${q.filters[field]}=${bind(a[field])}::uuid`);
    }
  if (from && to)
    where.push(
      `(${q.start}) < ((${bind(to)}::date+1)::timestamp AT TIME ZONE 'America/Denver') AND (${q.end}) >= (${bind(from)}::date::timestamp AT TIME ZONE 'America/Denver')`,
    );
  if (a.dateMode === "undated")
    where.push(`(${q.start} IS NULL OR ${q.end} IS NULL)`);
  const { cursor, limit: requestedLimit, ...filters } = a;
  const scope = inputHash([p.connectionId, filters]);
  let after: { id: string; order: number } | null = null;
  if (cursor)
    try {
      const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (
        c.scope !== scope ||
        !z.string().uuid().safeParse(c.id).success ||
        !Number.isSafeInteger(c.order)
      )
        throw Error();
      after = c;
    } catch {
      throw new ConnectionError("CONNECTION_INVALID_CURSOR");
    }
  const order = q.order ? `COALESCE(${q.order},0)` : "0";
  const inner = `SELECT ${q.select},${order} AS _order FROM ${q.from}${where.length ? " WHERE " + where.join(" AND ") : ""}`;
  const continuation = after
    ? ` WHERE (_order,id)>(${bind(after.order)}::integer,${bind(after.id)}::uuid)`
    : "";
  const limit = requestedLimit ?? 20;
  let rows: Record<string, any>[];
  try {
    rows = (
      await db.query(
        `SELECT * FROM (${inner}) operational${continuation} ORDER BY _order,id LIMIT ${bind(limit + 1)}`,
        params,
      )
    ).rows;
  } catch (error) {
    if (["42P01", "42703", "42883"].includes((error as any).code))
      return {
        section: a.section,
        availability: "unavailable",
        items: [],
        nextCursor: null,
        truncated: false,
        complete: false,
        reason:
          "Required operational storage is unavailable in this deployment; no conclusion about assignments can be drawn.",
        limitations,
      };
    throw error;
  }
  const items: Record<string, any>[] = [],
    taken: Record<string, any>[] = [];
  let bytes = JSON.stringify(limitations).length + 1500;
  for (const row of rows.slice(0, limit)) {
    const item = project(row);
    if (a.section === "bookings") item.bookingHref = `/bookings/${row.id}`;
    if (a.section === "trips") item.tripHref = `/trips/${row.id}`;
    if (a.section === "legs") item.legsHref = "/operations/legs";
    if (a.section === "leg_seasons") item.legsHref = "/operations/legs";
    const size = JSON.stringify(item).length;
    if (items.length && bytes + size > 24000) break;
    // A single unusually large row is explicitly incomplete, never silently dropped.
    if (size > 20000) {
      for (const k of Object.keys(item))
        if (typeof item[k] === "object" && item[k] !== null) {
          item[k] = null;
          item.truncatedFields = [...(item.truncatedFields ?? []), k];
        }
    }
    items.push(item);
    taken.push(row);
    bytes += JSON.stringify(item).length;
  }
  const more = rows.length > items.length,
    last = taken.at(-1);
  return {
    section: a.section,
    availability: "available",
    items,
    truncated: more,
    nextCursor:
      more && last
        ? Buffer.from(
            JSON.stringify({ scope, id: last.id, order: Number(last._order) }),
          ).toString("base64url")
        : null,
    complete: !more && !items.some((i) => i.truncatedFields?.length),
    dateFilter: from
      ? {
          from,
          to,
          timezone: "America/Denver",
          basis:
            "overlapping saved window; eventYear includes cross-year windows",
        }
      : a.dateMode === "undated"
        ? { mode: "undated" }
        : null,
    limitations: [
      ...limitations,
      ...(from
        ? [
            "Undated records are excluded from this date filter. Run dateMode=undated separately; no records does not prove availability.",
          ]
        : []),
    ],
  };
}

