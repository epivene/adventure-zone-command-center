import type { ResolvedDates } from "../booking-date-repair/date-evidence";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { isBookedForSchedule } from "../calendar/schedule-booking-state";
import { applyOperationalWindowsToCalendarBookings } from "../google-workspace/calendar/calendar-operational-window-projection";
import { classifyCalendarBooking } from "../lead-intake/calendar-booking-classifier";
import { normalizeStoredCalendarWindow } from "../lead-intake/calendar-window";
import {
  evaluateLegFeasibility,
  type DriveTimeEstimator,
} from "../leg-assignment/leg-feasibility";
import type {
  GoogleCalendarEvent,
  GoogleWorkspaceReadClient,
} from "../google-workspace/google-api-types";
import {
  evaluateCapacity,
  type CapacityDecision,
  type CapacityReservation,
} from "./capacity-policy";
import { rowsOf, type QueryDatabase } from "./outreach-sources";

export function fingerprint(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(sort(value)))
    .digest("hex");
}
export const day = (value: string | Date) =>
  new Date(value).toISOString().slice(0, 10);
export const addDays = (value: string, days: number) =>
  day(new Date(new Date(`${value}T00:00:00Z`).getTime() + days * 86400000));
const overlaps = (
  a: { startsOn: string; endsOn: string },
  b: { startsOn: string; endsOn: string },
) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
// Only the documented legacy keys from package-defaults are aliases.
export const canonicalPackageCode = (code: string) =>
  code === "warriors_playground"
    ? "weekend_warriors"
    : code === "pirate_rebellion"
      ? "pirates_rebellion"
      : code;
export function canonicalPackageQuantities(values: Record<string, number>) {
  const result: Record<string, number> = {};
  for (const [code, value] of Object.entries(values)) {
    const key = canonicalPackageCode(code);
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
}
export type BookingFact = {
  date_provenance?: ResolvedDates;
  id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  probability: string | null;
  travel_leg_id: string | null;
  latitude: number | null;
  longitude: number | null;
};
export type DemandFact = {
  booking_id: string;
  quantities: Record<string, number>;
  resource_ids: string[];
  facts_fingerprint: string;
  revision: number;
  actor: string;
  reason: string;
  updated_at: string;
};
export type HoldFact = {
  id: string;
  candidate_id: string;
  booking_id: string;
  opportunity_id: string;
  leg_id: string;
  event_starts_on: string;
  event_ends_on: string;
  starts_on: string;
  ends_on: string;
  quantities: Record<string, number>;
  resource_ids: string[];
  location: { latitude: number; longitude: number };
  demand_fingerprint: string;
  revision: number;
  state: "active" | "expired" | "released" | "converted";
  owner: string;
  expires_at: string;
  ended_at: string | null;
};
export type AllocationFacts = {
  generation: number | null;
  bookings: BookingFact[];
  windows: {
    booking_id: string;
    starts_at: string;
    ends_at: string;
    source: string;
  }[];
  selections: { booking_id: string; package_template_id: string }[];
  assignments: { booking_id: string; resource_id: string }[];
  packages: {
    id: string;
    code: string;
    normal_capacity: number;
    temporary_unavailable_quantity: number;
    active: boolean;
  }[];
  resources: {
    id: string;
    name: string;
    code: string;
    category: string;
    status: string;
    movable: boolean;
    normal_travel_leg_id: string | null;
    setup_minutes: number;
    teardown_minutes: number;
    minimum_transfer_minutes: number;
  }[];
  legs: { id: string; archived_at: string | null }[];
  mirrors: {
    booking_id: string;
    calendar_id: string;
    google_event_id: string;
    package_key: string;
    reserved_starts_at: string | null;
    reserved_ends_at: string | null;
    last_error_code: string | null;
    last_synced_at: string | null;
  }[];
  calendars: {
    calendar_id: string;
    connection_id: string;
    updated_at?: string;
  }[];
  demands: DemandFact[];
  holds: HoldFact[];
  anchors?: RouteAnchorFact[];
  unresolvedDispatches?: { id: string; hold_id: string }[];
  unverifiedClaims?: {
    id: string;
    booking_ids: string[];
    detail: {
      changes?: {
        bookingId: string;
        before: ImportedBookingClaim | null;
        after: ImportedBookingClaim | null;
      }[];
    };
  }[];
};
type ImportedBookingClaim = Pick<
  BookingFact,
  "id" | "status" | "probability" | "starts_at" | "ends_at" | "travel_leg_id"
> & {
  windows?: AllocationFacts["windows"];
  assignments?: AllocationFacts["assignments"];
  demand?: DemandFact;
};
export type RouteAnchorFact = {
  id: string;
  leg_id: string | null;
  resource_id: string | null;
  direction: "departure" | "return";
  latitude: number;
  longitude: number;
  available_at: string;
  valid_until: string;
  recorded_at: string;
  revoked_at: string | null;
  source: string;
  reason: string;
  actor: string;
  identity_fingerprint: string;
  revision: number;
};
export function anchorIdentity(
  f: AllocationFacts,
  a: Pick<RouteAnchorFact, "leg_id" | "resource_id">,
) {
  return fingerprint(
    a.resource_id
      ? f.resources.find((r) => r.id === a.resource_id)
      : f.legs.find((l) => l.id === a.leg_id),
  );
}
// Canonical semantic projection excludes generated selection/assignment row IDs
// and write timestamps. Source identities and meaningful configuration remain.
export function semanticAllocationFacts(f: AllocationFacts): AllocationFacts {
  const pick = (value: unknown, keys: string[]) =>
    Object.fromEntries(
      keys.map((k) => [k, (value as Record<string, unknown>)[k] ?? null]),
    );
  const configuration = (value: unknown) =>
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([k]) => !["created_at", "updated_at"].includes(k),
      ),
    );
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [
              k,
              typeof v === "string" &&
              k.endsWith("_at") &&
              !Number.isNaN(Date.parse(v))
                ? new Date(v).toISOString()
                : normalize(v),
            ]),
          )
        : value;
  return normalize({
    ...f,
    windows: f.windows.map((x) =>
      pick(x, ["booking_id", "starts_at", "ends_at", "source"]),
    ),
    selections: f.selections.map((x) =>
      pick(x, ["booking_id", "package_template_id"]),
    ),
    assignments: f.assignments.map((x) =>
      pick(x, ["booking_id", "resource_id"]),
    ),
    packages: f.packages.map(configuration),
    resources: f.resources.map(configuration),
    legs: f.legs.map(configuration),
    mirrors: f.mirrors.map((x) =>
      pick(x, [
        "booking_id",
        "calendar_id",
        "google_event_id",
        "package_key",
        "reserved_starts_at",
        "reserved_ends_at",
        "last_error_code",
        "last_synced_at",
      ]),
    ),
  }) as AllocationFacts;
}
// One SQL statement gives a consistent read. Secrets from Google connection rows are never selected.
export async function loadAllocationFacts(
  db: QueryDatabase,
): Promise<AllocationFacts> {
  const facts = semanticAllocationFacts(
    rowsOf<{ facts: AllocationFacts }>(
      await db.execute(sql`select jsonb_build_object(
    'generation',(select generation from outreach_allocation_mutex where id=1),
    'bookings',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from (select b.id,b.name,b.starts_at,b.ends_at,b.status,b.probability,b.travel_leg_id,b.latitude,b.longitude,booking_resolved_dates(b.id,b.starts_at,b.ends_at,w.starts_at,w.ends_at) as date_provenance from bookings b left join booking_operational_windows w on w.booking_id=b.id) t),
    'windows',(select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_id),'[]') from booking_operational_windows t),
    'selections',(select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_id,t.package_template_id),'[]') from booking_package_selections t),
    'assignments',(select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_id,t.resource_id),'[]') from booking_resource_assignments t),
    'packages',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from package_templates t),
    'resources',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from resources t),
    'legs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from travel_legs t),
    'mirrors',(select coalesce(jsonb_agg(to_jsonb(t) order by t.calendar_id,t.google_event_id),'[]') from google_operational_calendar_links t),
    'calendars',(select coalesce(jsonb_agg(to_jsonb(t) order by t.calendar_id,t.connection_id),'[]') from (select s.calendar_id,s.connection_id,s.updated_at from google_workspace_calendar_scopes s join google_workspace_connections c on c.id=s.connection_id where s.selected=true and c.status='connected') t),
    'demands',(select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_id),'[]') from outreach_booking_demand t),
    'holds',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from outreach_holds t),
    'anchors',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from outreach_route_anchors t),
    'unresolvedDispatches',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from (select id,hold_id from outreach_dispatches where hold_id is not null and state in ('dispatching','uncertain')) t),
    'unverifiedClaims',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from (select id,booking_ids,detail from outreach_reconciliation_facts where source='assistant-history-import' and state='needs_review') t)
  ) as facts`),
    )[0].facts,
  );
  facts.bookings = facts.bookings.map(b => ({
    ...b, starts_at: b.date_provenance?.publicWindow?.start ?? null, ends_at: b.date_provenance?.publicWindow?.end ?? null,
  }));
  facts.windows = facts.windows.flatMap(w => {
    const dates = facts.bookings.find(b => b.id === w.booking_id)?.date_provenance;
    return dates?.reservationWindow ? [{...w,starts_at:dates.reservationWindow.start,ends_at:dates.reservationWindow.end,source:"reviewed_timestamp"}] : [];
  });
  return facts;
}
export function bookingDemandFacts(
  f: AllocationFacts,
  b: BookingFact,
  resourceIds: string[] = f.demands.find((d) => d.booking_id === b.id)
    ?.resource_ids ?? [],
) {
  const { id, starts_at, ends_at, travel_leg_id, latitude, longitude } = b;
  return {
    id,
    starts_at,
    ends_at,
    travel_leg_id,
    latitude,
    longitude,
    windows: f.windows.filter((x) => x.booking_id === id),
    selections: f.selections.filter((x) => x.booking_id === id),
    assignments: f.assignments.filter((x) => x.booking_id === id),
    resourceConfiguration: f.resources.filter((r) =>
      resourceIds.includes(r.id),
    ),
    packageConfiguration: f.packages.filter((p) =>
      f.selections.some(
        (s) => s.booking_id === id && s.package_template_id === p.id,
      ),
    ),
  };
}
export type AllocationTarget = {
  bookingId: string;
  eventStartsOn: string;
  eventEndsOn: string;
  startsOn: string;
  endsOn: string;
  legId: string;
  quantities: Record<string, number>;
  resourceIds: string[];
  location: { latitude: number; longitude: number };
  demandFingerprint: string;
};
export function targetForBooking(
  f: AllocationFacts,
  bookingId: string,
): { target: AllocationTarget | null; reasons: string[] } {
  const b = f.bookings.find((x) => x.id === bookingId),
    d = f.demands.find((x) => x.booking_id === bookingId);
  const reasons: string[] = [];
  if (!b?.date_provenance?.publicWindow || ((b.date_provenance.rawReservation.start || b.date_provenance.rawReservation.end) && !b.date_provenance.reservationWindow))
    return { target: null, reasons: ["Booking date evidence is unresolved."] };
  if (
    !b?.starts_at ||
    !b.ends_at ||
    !Number.isFinite(new Date(b.starts_at).getTime()) ||
    !Number.isFinite(new Date(b.ends_at).getTime()) ||
    b.ends_at < b.starts_at
  )
    return {
      target: null,
      reasons: ["Booking needs valid actual event dates."],
    };
  if (
    !b.travel_leg_id ||
    !f.legs.some((x) => x.id === b.travel_leg_id && !x.archived_at)
  )
    reasons.push("Booking needs an active transport leg.");
  if (
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude) ||
    Math.abs(b.latitude!) > 90 ||
    Math.abs(b.longitude!) > 180
  )
    reasons.push("Booking location needs verified coordinates.");
  if (!d || !Object.keys(d.quantities).length || !d.resource_ids.length)
    reasons.push(
      "Record exact package quantities and required physical resources for this booking.",
    );
  else {
    if (d.facts_fingerprint !== fingerprint(bookingDemandFacts(f, b)))
      reasons.push(
        "Booking dates, location, leg or assignments changed; review exact demand again.",
      );
    const selected = f.selections
      .filter((x) => x.booking_id === bookingId)
      .map((x) => f.packages.find((p) => p.id === x.package_template_id)?.code)
      .sort();
    if (fingerprint(selected) !== fingerprint(Object.keys(d.quantities).sort()))
      reasons.push(
        "Exact package demand must match the booking's selected packages.",
      );
    if (d.resource_ids.some((id) => !f.resources.some((r) => r.id === id)))
      reasons.push("A required physical resource no longer exists.");
    const assigned = f.assignments
      .filter((x) => x.booking_id === bookingId)
      .map((x) => x.resource_id)
      .sort();
    if (
      assigned.some((id) => !d.resource_ids.includes(id)) ||
      (isBookedForSchedule(b) &&
        fingerprint(assigned) !== fingerprint([...d.resource_ids].sort()))
    )
      reasons.push(
        "Physical assignments do not match the exact resource demand.",
      );
  }
  if (reasons.length) return { target: null, reasons };
  // Treat prospects with the same default -2/+1 operational occupancy as definite bookings.
  const [projected] = applyOperationalWindowsToCalendarBookings(
    [
      {
        id: b.id,
        startsAt: new Date(b.starts_at),
        endsAt: new Date(b.ends_at),
        status: "confirmed",
      },
    ],
    f.windows
      .filter((w) => w.booking_id === b.id)
      .map((w) => ({
        bookingId: w.booking_id,
        startsAt: new Date(w.starts_at),
        endsAt: new Date(w.ends_at),
        source: w.source,
      })),
  );
  const target = {
    bookingId,
    eventStartsOn: day(b.starts_at),
    eventEndsOn: day(b.ends_at),
    startsOn: day(projected.startsAt!),
    endsOn: day(projected.endsAt!),
    legId: b.travel_leg_id!,
    quantities: d!.quantities,
    resourceIds: [...d!.resource_ids].sort(),
    location: { latitude: b.latitude!, longitude: b.longitude! },
    demandFingerprint: "",
  };
  if (
    target.startsOn > target.eventStartsOn ||
    target.endsOn < target.eventEndsOn
  )
    return {
      target: null,
      reasons: ["Operational window must contain the actual event."],
    };
  target.demandFingerprint = fingerprint({
    ...target,
    demandRevision: d!.revision,
  });
  return { target, reasons };
}
function quantities(
  target: Pick<AllocationTarget, "quantities" | "resourceIds">,
) {
  return {
    ...Object.fromEntries(
      Object.entries(canonicalPackageQuantities(target.quantities)).map(
        ([k, v]) => [`package:${k}`, v],
      ),
    ),
    ...Object.fromEntries(
      target.resourceIds.map((id) => [`resource:${id}`, 1]),
    ),
  };
}
function holdTarget(h: HoldFact): AllocationTarget {
  return {
    bookingId: h.booking_id,
    eventStartsOn: h.event_starts_on,
    eventEndsOn: h.event_ends_on,
    startsOn: h.starts_on,
    endsOn: h.ends_on,
    legId: h.leg_id,
    quantities: h.quantities,
    resourceIds: h.resource_ids,
    location: h.location,
    demandFingerprint: h.demand_fingerprint,
  };
}
export type Projection = {
  reservations: CapacityReservation[];
  stops: AllocationTarget[];
  reasons: string[];
  capacities: Record<string, number>;
};
export function projectReservations(
  f: AllocationFacts,
  target: AllocationTarget,
  now: Date,
): Projection {
  const projection: Projection = {
    reservations: [],
    stops: [],
    reasons: [],
    capacities: {
      ...Object.fromEntries(
        f.resources.map((r) => [
          `resource:${r.id}`,
          r.status === "available" ? 1 : 0,
        ]),
      ),
    },
  };
  for (const code of new Set(
    f.packages.map((p) => canonicalPackageCode(p.code)),
  )) {
    const active = f.packages.filter(
      (p) => p.active && canonicalPackageCode(p.code) === code,
    );
    if (active.length > 1)
      projection.reasons.push(
        `Multiple active inventory definitions for ${code}; reconcile aliases before allocation.`,
      );
    projection.capacities[`package:${code}`] =
      active.length === 1
        ? Math.max(
            0,
            active[0].normal_capacity -
              active[0].temporary_unavailable_quantity,
          )
        : 0;
  }
  for (const b of f.bookings.filter(isBookedForSchedule)) {
    if (b.id === target.bookingId) continue;
    const result = targetForBooking(f, b.id);
    if (result.reasons.includes("Booking date evidence is unresolved.")) {
      projection.reasons.push("Booking " + b.id + ": Booking date evidence is unresolved.");
      continue;
    }
    if (!result.target) {
      // Missing demand on an unrelated dated history row must not block current work.
      const [p] = applyOperationalWindowsToCalendarBookings(
        [
          {
            id: b.id,
            startsAt: b.starts_at ? new Date(b.starts_at) : null,
            endsAt: b.ends_at ? new Date(b.ends_at) : null,
            status: b.status,
            probability: b.probability,
          },
        ],
        f.windows
          .filter((w) => w.booking_id === b.id)
          .map((w) => ({
            bookingId: w.booking_id,
            startsAt: new Date(w.starts_at),
            endsAt: new Date(w.ends_at),
            source: w.source,
          })),
      );
      if (
        !p.startsAt ||
        !p.endsAt ||
        overlaps(target, { startsOn: day(p.startsAt), endsOn: day(p.endsAt) })
      )
        projection.reasons.push(`Booking ${b.id}: ${result.reasons.join(" ")}`);
      // Adjacent stops still matter even if package demand is missing.
      if (
        p.startsAt &&
        p.endsAt &&
        (b.travel_leg_id === target.legId ||
          f.assignments.some(
            (a) =>
              a.booking_id === b.id &&
              target.resourceIds.includes(a.resource_id),
          ))
      ) {
        projection.stops.push({
          bookingId: b.id,
          eventStartsOn: b.starts_at ? day(b.starts_at) : day(p.startsAt),
          eventEndsOn: b.ends_at ? day(b.ends_at) : day(p.endsAt),
          startsOn: day(p.startsAt),
          endsOn: day(p.endsAt),
          legId: b.travel_leg_id ?? "",
          quantities: {},
          resourceIds: f.assignments
            .filter((a) => a.booking_id === b.id)
            .map((a) => a.resource_id),
          location: { latitude: b.latitude!, longitude: b.longitude! },
          demandFingerprint: "unverified",
        });
      }
      continue;
    }
    const x = result.target;
    projection.reservations.push({
      id: b.id,
      canonicalId: `booking:${b.id}`,
      startsOn: x.startsOn,
      endsOn: x.endsOn,
      legId: x.legId,
      quantities: quantities(x),
      confidence: "verified",
    });
    projection.stops.push(x);
  }
  for (const h of f.holds.filter(
    (h) => h.state === "active" && new Date(h.expires_at) > now,
  )) {
    const x = holdTarget(h);
    // No automatic self-exclusion for holds; caller must explicitly identify its own hold.
    projection.reservations.push({
      id: h.id,
      canonicalId: `hold:${h.id}`,
      startsOn: x.startsOn,
      endsOn: x.endsOn,
      legId: x.legId,
      quantities: quantities(x),
      confidence: "verified",
    });
    projection.stops.push({ ...x, bookingId: `hold:${h.id}` });
  }
  if (f.unresolvedDispatches?.length) {
    projection.reasons.push(
      "An unresolved specific-offer delivery may reserve shared capacity. Reconcile the provider outcome before allocating.",
    );
  }
  if (f.unverifiedClaims?.length) {
    // Leg and physical-resource histories are independent. A later equipment
    // stop on another leg cannot hide an unresolved claim on the target leg,
    // nor can one resource's nearer stop hide another resource's source history.
    const claimLegCorridor = adjacentStops(
      target,
      projection.stops.filter((s) => s.legId === target.legId),
    );
    const claimResourceCorridors = new Map(
      target.resourceIds.map((id) => [
        id,
        adjacentStops(
          target,
          projection.stops.filter((s) => s.resourceIds.includes(id)),
        ),
      ]),
    );
    for (const claim of f.unverifiedClaims ?? []) {
      const changes = claim.detail.changes ?? [];
      if (!changes.length && claim.booking_ids.length)
        projection.reasons.push(
          `Imported claim ${claim.id} has no reviewed source facts.`,
        );
      for (const change of changes)
        for (const b of [change.before, change.after]) {
          if (!b || !isBookedForSchedule(b)) continue;
          let relevant =
            b.id === target.bookingId || !b.starts_at || !b.ends_at;
          if (b.starts_at && b.ends_at) {
            const startsOn = [
              addDays(day(b.starts_at), -2),
              ...(b.windows ?? []).map((w) => day(w.starts_at)),
            ].sort()[0];
            const endsOn = [
              addDays(day(b.ends_at), 1),
              ...(b.windows ?? []).map((w) => addDays(day(w.ends_at), -1)),
            ]
              .sort()
              .at(-1)!;
            relevant ||= overlaps(target, { startsOn, endsOn });
            // Inspect both snapshots independently, preserving the union of
            // legacy physical assignments and any reviewed exact-demand IDs.
            const resourceIds = new Set([
              ...(b.assignments ?? []).map((a) => a.resource_id),
              ...(b.demand?.resource_ids ?? []),
            ]);
            const corridors = [
              ...(b.travel_leg_id === target.legId ? [claimLegCorridor] : []),
              ...[...resourceIds].flatMap((id) => {
                const corridor = claimResourceCorridors.get(id);
                return corridor ? [corridor] : [];
              }),
            ];
            relevant ||= corridors.some(
              (adjacent) =>
                (endsOn < target.startsOn &&
                  (!adjacent.previous.length ||
                    adjacent.previous.some((s) => endsOn >= s.endsOn))) ||
                (startsOn > target.endsOn &&
                  (!adjacent.next.length ||
                    adjacent.next.some((s) => startsOn <= s.startsOn))),
            );
          }
          if (relevant)
            projection.reasons.push(
              `Imported commitment claim ${claim.id} needs independent owner source review; recording exact demand does not verify its provenance.`,
            );
        }
    }
  }
  return projection;
}
export type ExternalEvidence = {
  checkedAt: string;
  expiresAt: string;
  startsOn: string;
  endsOn: string;
  calendarIds: string[];
  events: GoogleCalendarEvent[];
  errors: string[];
};
export type AllocationProviders = {
  readClient(): Promise<Pick<
    GoogleWorkspaceReadClient,
    "listCalendarEvents"
  > | null>;
  estimator: DriveTimeEstimator;
};
export async function readExternalEvidence(
  f: AllocationFacts,
  target: AllocationTarget,
  providers: AllocationProviders,
  now: Date,
): Promise<ExternalEvidence> {
  // Full year either side includes route context; absent adjacent CRM stops is not proof of travel from an unknown depot.
  const startsOn = `${Number(target.eventStartsOn.slice(0, 4)) - 1}-01-01`,
    endsOn = `${Number(target.eventEndsOn.slice(0, 4)) + 1}-12-31`;
  const evidence: ExternalEvidence = {
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 120000).toISOString(),
    startsOn,
    endsOn,
    calendarIds: [...new Set(f.calendars.map((x) => x.calendar_id))].sort(),
    events: [],
    errors: [],
  };
  try {
    const client = await providers.readClient();
    if (!client?.listCalendarEvents || !evidence.calendarIds.length)
      throw new Error("No connected selected Calendar is available.");
    evidence.events = await client.listCalendarEvents({
      calendarIds: evidence.calendarIds,
      timeMin: `${startsOn}T00:00:00Z`,
      timeMax: `${addDays(endsOn, 1)}T00:00:00Z`,
    });
    if (
      evidence.events.some((e) => !evidence.calendarIds.includes(e.calendarId))
    )
      throw new Error("Calendar returned an unexpected source identity.");
  } catch {
    evidence.errors.push(
      "Fresh selected Calendar coverage is unavailable; reconnect or retry.",
    );
  }
  return evidence;
}
/** Retain every stop at the nearest boundary; row order is not location evidence. */
function adjacentStops(target: AllocationTarget, stops: AllocationTarget[]) {
  const previous = stops.filter((s) => s.endsOn < target.startsOn);
  const next = stops.filter((s) => s.startsOn > target.endsOn);
  const previousBoundary = previous
    .map((s) => s.endsOn)
    .sort()
    .at(-1);
  const nextBoundary = next.map((s) => s.startsOn).sort()[0];
  return {
    previous: previous.filter((s) => s.endsOn === previousBoundary),
    next: next.filter((s) => s.startsOn === nextBoundary),
  };
}
function adjacentLocationDisagrees(stops: AllocationTarget[]) {
  return new Set(stops.map((s) => fingerprint([s.legId, s.location]))).size > 1;
}

function routeAnchor(
  f: AllocationFacts,
  target: AllocationTarget,
  direction: RouteAnchorFact["direction"],
  resourceId: string | undefined,
  now: Date,
) {
  const anchors = (f.anchors ?? []).filter(
    (a) =>
      !a.revoked_at &&
      new Date(a.recorded_at) <= now &&
      new Date(a.valid_until) > now &&
      day(a.valid_until) >= target.endsOn &&
      a.identity_fingerprint === anchorIdentity(f, a) &&
      (resourceId
        ? a.resource_id === resourceId
        : a.leg_id === target.legId && !a.resource_id) &&
      a.direction === direction,
  );
  // A route anchor is a current physical fact, not an optional optimistic stop.
  // A later replacement supersedes the old source through the audited action.
  if (
    new Set(
      anchors.map((a) =>
        fingerprint([a.available_at, a.latitude, a.longitude]),
      ),
    ).size > 1
  )
    return null;
  return anchors[0] ?? null;
}
export function reconcileCalendar(
  f: AllocationFacts,
  target: AllocationTarget,
  external: ExternalEvidence,
): string[] {
  const reasons = [...external.errors],
    grouped = new Map<string, Map<string, number>>();
  // An unlinked event can also be an intervening route/equipment stop. Include
  // the corridors between target and each known adjacent leg/resource stop.
  const stops = projectReservations(
    f,
    target,
    new Date(external.checkedAt),
  ).stops;
  const corridors = [
    stops.filter((s) => s.legId === target.legId),
    ...target.resourceIds.map((id) =>
      stops.filter((s) => s.resourceIds.includes(id)),
    ),
  ];
  const travelScope = { ...target };
  for (const [index, route] of corridors.entries()) {
    const { previous, next } = adjacentStops(target, route);
    for (const direction of ["departure", "return"] as const) {
      const anchor = routeAnchor(
        f,
        target,
        direction,
        index ? target.resourceIds[index - 1] : undefined,
        new Date(external.checkedAt),
      );
      if (anchor) {
        const on = day(anchor.available_at);
        if (on < travelScope.startsOn) travelScope.startsOn = on;
        if (on > travelScope.endsOn) travelScope.endsOn = on;
      }
    }
    if (adjacentLocationDisagrees(previous) || adjacentLocationDisagrees(next))
      reasons.push(
        "Equally adjacent Calendar route stops disagree on physical location or leg; reconcile the source facts.",
      );
    for (const before of previous)
      if (before.startsOn < travelScope.startsOn)
        travelScope.startsOn = before.startsOn;
    for (const after of next)
      if (after.endsOn > travelScope.endsOn) travelScope.endsOn = after.endsOn;
  }
  if (
    travelScope.startsOn < external.startsOn ||
    travelScope.endsOn > external.endsOn
  )
    reasons.push(
      "Fresh Calendar coverage does not include the adjacent route corridor.",
    );
  for (const event of external.events) {
    let window;
    try {
      const w = normalizeStoredCalendarWindow({
        start: event.start,
        end: event.end,
        calendarTimeZone: event.calendarTimeZone,
      });
      window = { startsOn: w.startDate, endsOn: w.endDate };
    } catch {
      reasons.push(
        `Calendar event ${event.calendarId}/${event.id} has invalid dates.`,
      );
      continue;
    }
    const links = f.mirrors.filter(
      (m) =>
        m.calendar_id === event.calendarId && m.google_event_id === event.id,
    );
    if (links.length !== 1) {
      if (overlaps(travelScope, window))
        reasons.push(
          `Calendar event ${event.calendarId}/${event.id} needs canonical booking, leg and physical-resource review.`,
        );
      continue;
    }
    const link = links[0],
      booking = f.bookings.find((b) => b.id === link.booking_id),
      match = targetForBooking(f, link.booking_id).target;
    // Unrelated history without modern quantities does not block this window.
    if (!match) {
      if (overlaps(travelScope, window))
        reasons.push(
          `Calendar booking ${link.booking_id} lacks reviewed exact demand.`,
        );
      continue;
    }
    const parsed = classifyCalendarBooking({
      summary: event.summary,
      description: event.description,
    });
    if (
      link.last_error_code ||
      !booking ||
      !isBookedForSchedule(booking) ||
      window.startsOn !== match.startsOn ||
      window.endsOn !== match.endsOn ||
      parsed.confidence !== "explicit"
    ) {
      if (overlaps(travelScope, window) || overlaps(travelScope, match))
        reasons.push(
          `Calendar mirror for ${link.booking_id} contradicts booking status, dates or explicit quantities.`,
        );
      continue;
    }
    const packageMap =
      grouped.get(link.booking_id) ?? new Map<string, number>();
    for (const p of parsed.packages) {
      if (
        packageMap.has(p.packageKey) &&
        packageMap.get(p.packageKey) !== p.quantity
      )
        reasons.push(
          `Contradictory Calendar quantities for ${link.booking_id}/${p.packageKey}.`,
        );
      packageMap.set(p.packageKey, p.quantity);
    }
    grouped.set(link.booking_id, packageMap);
  }
  for (const [bookingId, values] of grouped) {
    const match = targetForBooking(f, bookingId).target!;
    if (
      overlaps(travelScope, match) &&
      fingerprint(Object.fromEntries(values)) !==
        fingerprint(canonicalPackageQuantities(match.quantities))
    )
      reasons.push(
        `Calendar package mirrors for ${bookingId} do not agree with exact CRM quantities.`,
      );
  }
  for (const link of f.mirrors) {
    const b = targetForBooking(f, link.booking_id).target;
    if (
      b &&
      overlaps(travelScope, b) &&
      external.calendarIds.includes(link.calendar_id) &&
      !external.events.some(
        (e) =>
          e.calendarId === link.calendar_id && e.id === link.google_event_id,
      )
    )
      reasons.push(
        `Linked Calendar event for ${link.booking_id} is missing from fresh coverage.`,
      );
  }
  return [...new Set(reasons)];
}
export async function verifyTravel(
  f: AllocationFacts,
  target: AllocationTarget,
  projection: Projection,
  estimator: DriveTimeEstimator,
  now: Date = new Date(),
): Promise<string[]> {
  const reasons: string[] = [];
  const estimates = new Map<string, Promise<number | null>>();
  const freshEstimator: DriveTimeEstimator = {
    estimateMinutes(from, to) {
      const key = fingerprint([from, to]);
      if (!estimates.has(key))
        estimates.set(
          key,
          estimator
            .estimateMinutes(from, to)
            .then((value) =>
              value !== null && Number.isFinite(value) && value >= 0
                ? value
                : null,
            ),
        );
      return estimates.get(key)!;
    },
  };
  const check = async (stops: AllocationTarget[], resourceId?: string) => {
    const adjacent = adjacentStops(target, stops);
    if (
      adjacentLocationDisagrees(adjacent.previous) ||
      adjacentLocationDisagrees(adjacent.next)
    ) {
      reasons.push(
        `${resourceId ? `Resource ${resourceId}` : "Leg"} has equally adjacent stops with contradictory physical locations or legs; reconcile the source facts.`,
      );
      return;
    }
    // Equal-boundary stops may share a proven location/leg. Only after that
    // consistency check is one representative sufficient for the travel gap.
    let previous: AllocationTarget | undefined = adjacent.previous[0];
    let next: AllocationTarget | undefined = adjacent.next[0];
    for (const direction of ["departure", "return"] as const) {
      const recorded = (f.anchors ?? []).some(
        (a) =>
          !a.revoked_at &&
          a.direction === direction &&
          (resourceId
            ? a.resource_id === resourceId
            : a.leg_id === target.legId && !a.resource_id),
      );
      if (recorded && !routeAnchor(f, target, direction, resourceId, now)) {
        reasons.push(
          "Recorded route anchor is stale, outside its verified period, or contradictory; reconcile its actual location and availability.",
        );
        return;
      }
    }
    let origin = routeAnchor(f, target, "departure", resourceId, now);
    let destination = routeAnchor(f, target, "return", resourceId, now);
    for (const [stop, anchor, direction] of [
      [previous, origin, "departure"],
      [next, destination, "return"],
    ] as const) {
      if (!stop || !anchor) continue;
      const boundary = new Date(
        `${direction === "departure" ? addDays(stop.endsOn, 1) : stop.startsOn}T00:00:00Z`,
      ).getTime();
      if (
        boundary === new Date(anchor.available_at).getTime() &&
        fingerprint(stop.location) !==
          fingerprint({
            latitude: anchor.latitude,
            longitude: anchor.longitude,
          })
      ) {
        reasons.push(
          "Route anchor and adjacent event disagree on the physical location at the same time.",
        );
        return;
      }
    }
    if (
      origin &&
      (!previous ||
        new Date(origin.available_at) >=
          new Date(`${addDays(previous.endsOn, 1)}T00:00:00Z`))
    )
      previous = undefined;
    else origin = null;
    if (
      destination &&
      (!next ||
        new Date(destination.available_at) <=
          new Date(`${next.startsOn}T00:00:00Z`))
    )
      next = undefined;
    else destination = null;
    if ((!previous && !origin) || (!next && !destination)) {
      reasons.push(
        `${resourceId ? `Resource ${resourceId}` : "Leg"} needs both adjacent route locations or current audited departure/return anchors to verify travel.`,
      );
      return;
    }
    const toStop = (s: AllocationTarget) => ({
      bookingId: s.bookingId,
      name: s.bookingId,
      latitude: s.location.latitude,
      longitude: s.location.longitude,
      startsAt: new Date(`${s.startsOn}T00:00:00Z`),
      endsAt: new Date(`${addDays(s.endsOn, 1)}T00:00:00Z`),
    });
    if (
      [previous, next]
        .filter((s): s is AllocationTarget => Boolean(s))
        .some(
          (s) =>
            !Number.isFinite(s.location.latitude) ||
            !Number.isFinite(s.location.longitude),
        )
    ) {
      reasons.push("Adjacent stop location is missing.");
      return;
    }
    const anchorStop = (a: RouteAnchorFact) => ({
      bookingId: `anchor:${a.id}`,
      name: a.source,
      latitude: a.latitude,
      longitude: a.longitude,
      startsAt: new Date(a.available_at),
      endsAt: new Date(a.available_at),
    });
    const result = await evaluateLegFeasibility({
      target: {
        ...toStop(target),
        organizationId: null,
        status: "proposed",
        travelLegId: target.legId,
      },
      previousStop: previous ? toStop(previous) : anchorStop(origin!),
      nextStop: next ? toStop(next) : anchorStop(destination!),
      estimator: freshEstimator,
    });
    if (!result.eligible) reasons.push(result.reason);
    if (resourceId) {
      const resource = f.resources.find((r) => r.id === resourceId)!;
      if (
        !resource.movable &&
        ((previous && previous.legId !== target.legId) ||
          (next && next.legId !== target.legId) ||
          resource.normal_travel_leg_id !== target.legId)
      )
        reasons.push(
          `Resource ${resourceId} cannot transfer between these legs.`,
        );
      const required = (drive: number | null) =>
        Math.max(
          resource.minimum_transfer_minutes,
          (drive ?? Infinity) +
            resource.setup_minutes +
            resource.teardown_minutes,
        );
      if (
        (result.availableBeforeMinutes ?? 0) <
          required(result.previousDriveMinutes) ||
        (result.availableAfterMinutes ?? 0) < required(result.nextDriveMinutes)
      )
        reasons.push(
          `Resource ${resourceId} lacks required transfer/setup time.`,
        );
    }
  };
  try {
    await check(projection.stops.filter((s) => s.legId === target.legId));
    for (const id of target.resourceIds)
      await check(
        projection.stops.filter((s) => s.resourceIds.includes(id)),
        id,
      );
  } catch {
    reasons.push("Route provider unavailable; retry travel verification.");
  }
  return [...new Set(reasons)];
}
export function capacityDecision(
  target: AllocationTarget,
  projection: Projection,
  reasons: string[],
): CapacityDecision {
  const decision = evaluateCapacity({
    window: target,
    legId: target.legId,
    quantities: quantities(target),
    capacities: projection.capacities,
    reservations: projection.reservations,
    evidenceVerified: !projection.reasons.length,
    travelVerified: true,
  });
  if (projection.reasons.length || reasons.length)
    return {
      status: "needs_review",
      reasons: [
        ...new Set([...projection.reasons, ...reasons, ...decision.reasons]),
      ],
    };
  return decision;
}
export function excludeOwnHold(
  projection: Projection,
  holdId: string | undefined,
) {
  if (!holdId) return projection;
  return {
    ...projection,
    reservations: projection.reservations.filter(
      (r) => r.canonicalId !== `hold:${holdId}`,
    ),
    stops: projection.stops.filter((s) => s.bookingId !== `hold:${holdId}`),
  };
}
