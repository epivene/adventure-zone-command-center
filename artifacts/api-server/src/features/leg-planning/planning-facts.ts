import { planningStartCalendar } from "./operational-window";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { canonicalPackageCode } from "../outreach-planner/outreach-capacity-evidence";
import {
  crewAvailabilitySchema,
  packageSetSchema,
  legSeasonPlanSchema,
  type PlanDraft,
  type PlanFacts,
  type PlanObligation,
  type PlanningActor,
  type WindowInput,
} from "@workspace/api-zod";
import {
  DrizzlePlanningRepository,
  planningRows,
  type PlanningDatabase,
} from "./planning-repository";
import {
  operationsReadDate,
  operationsSeason,
  isImportedCalendarDate,
} from "../bookings/booking-leg-operations-history";
import { resolveOperationalWindow, windowContains } from "./operational-window";

type Row = Record<string, any>;
const iso = (value: unknown) =>
  value == null ? null : new Date(String(value)).toISOString();
function sourceWindow(row: Row): WindowInput | null {
  const reserved =
    row.reserved_starts_at != null && row.reserved_ends_at != null;
  const start = reserved ? row.reserved_starts_at : row.starts_at,
    end = reserved ? row.reserved_ends_at : row.ends_at;
  if (!start || !end) return null;
  const dateOnly = reserved
    ? row.reserved_source === "google_calendar" &&
      String(iso(start)).endsWith("T00:00:00.000Z")
    : isImportedCalendarDate(start, row.imported_dates === true);
  return {
    startsAt: operationsReadDate(start, dateOnly),
    endsAt: operationsReadDate(end, dateOnly),
    semantics: dateOnly
      ? reserved
        ? "exclusive_date"
        : "inclusive_date"
      : "timestamp",
    source: reserved ? String(row.reserved_source) : "booking",
  };
}
function emptyDraft(booking: Row, actor: PlanningActor): PlanDraft {
  const sourceYear = operationsSeason(
    booking.starts_at,
    isImportedCalendarDate(booking.starts_at, booking.imported_dates === true),
  );
  return {
    bookingId: booking.id,
    legId:
      booking.travel_leg_id ??
      (actor.kind === "manager"
        ? actor.legId
        : "00000000-0000-4000-8000-000000000000"),
    seasonYear:
      sourceYear !== null && sourceYear >= 1900 && sourceYear <= 9998
        ? sourceYear
        : new Date().getUTCFullYear(),
    window: null,
    phases: {},
    requirements: {
      minimumCrew: null,
      roles: null,
      transportRequired: null,
      lodging: "unknown",
      lodgingReason: null,
    },
    crew: [],
    packageSetIds: [],
    transportResourceIds: [],
    lodging: [],
    splitGroupId: null,
  };
}
export function planningFingerprint(facts: PlanFacts): string {
  const sort = (v: any): any =>
    Array.isArray(v)
      ? v
          .map(sort)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .filter(
                ([k]) =>
                  ![
                    "revision",
                    "verifiedAt",
                    "verifiedBy",
                    "reviewedAt",
                  ].includes(k),
              )
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  const workerIds = new Set(facts.draft.crew.map((c) => c.workerId));
  const setIds = new Set(facts.draft.packageSetIds);
  const resourceIds = new Set([
    ...facts.draft.transportResourceIds,
    ...facts.packageSets
      .filter((s) => setIds.has(s.id))
      .flatMap((s) => s.resourceIds),
  ]);
  const input = {
    draft: facts.draft,
    booking: {
      ...facts.booking,
      legId: undefined,
      window: normalizedFingerprintWindow(reviewedReservation(facts)),
      publicWindow: normalizedFingerprintWindow(
        facts.booking.publicWindow ?? null,
      ),
    },
    season: facts.season,
    workers: facts.workers.filter((w) => workerIds.has(w.id)),
    availability: facts.availability.filter((a) => workerIds.has(a.workerId)),
    sets: facts.packageSets.filter((s) => setIds.has(s.id)),
    resources: facts.resources.filter((r) => resourceIds.has(r.id)),
    packages: facts.packages.filter((p) =>
      facts.booking.packageIds.includes(p.id),
    ),
    split: facts.split,
    branches: facts.branches,
    travel: facts.travel,
  };
  return createHash("sha256")
    .update(JSON.stringify(sort(input)))
    .digest("hex");
}
function reviewedReservation(facts: PlanFacts): WindowInput | null {
  const proposed =
    facts.draft.window && resolveOperationalWindow(facts.draft.window);
  const canonical =
    facts.booking.window && resolveOperationalWindow(facts.booking.window);
  return proposed?.state === "resolved" &&
    canonical?.state === "resolved" &&
    windowContains(proposed.window, canonical.window)
    ? facts.draft.window
    : facts.booking.window;
}
function normalizedFingerprintWindow(input: WindowInput | null) {
  const resolved = input && resolveOperationalWindow(input);
  return resolved?.state === "resolved"
    ? { startMs: resolved.window.startMs, endMs: resolved.window.endMs }
    : input;
}
export async function loadPlanFacts(
  tx: PlanningDatabase,
  bookingIds: string[],
  actor: PlanningActor,
  now: Date,
): Promise<PlanFacts[]> {
  const repo = new DrizzlePlanningRepository(tx);
  for (const id of bookingIds) await repo.authorizeBookingIn(tx, id, actor);
  const query = async (statement: ReturnType<typeof sql>) =>
    planningRows<Row>(await tx.execute(statement));
  const [
    bookings,
    selections,
    allocations,
    workers,
    availability,
    sets,
    resources,
    packages,
    crews,
    trips,
    stops,
    tripResources,
    holds,
    seasons,
    splits,
    requests,
    decisions,
    authorities,
    plans,
    managerAccess,
  ] = await Promise.all([
    query(
      sql`SELECT b.id,b.status,b.travel_leg_id,b.starts_at,b.ends_at,b.latitude,b.longitude,w.starts_at AS reserved_starts_at,w.ends_at AS reserved_ends_at,w.source AS reserved_source,EXISTS(SELECT 1 FROM google_operational_calendar_links c WHERE c.booking_id=b.id AND c.last_app_snapshot->>'imported'='true') AS imported_dates FROM bookings b LEFT JOIN booking_operational_windows w ON w.booking_id=b.id`,
    ),
    query(
      sql`SELECT booking_id,package_template_id FROM booking_package_selections`,
    ),
    query(sql`SELECT booking_id,resource_id FROM booking_resource_assignments`),
    query(sql`SELECT id,name,rehire_status FROM crew_workers`),
    query(sql`SELECT * FROM crew_availability`),
    query(sql`SELECT * FROM package_sets`),
    query(
      sql`SELECT id,name,category,status,minimum_transfer_minutes FROM resources`,
    ),
    query(
      sql`SELECT id,name,code,normal_capacity,temporary_unavailable_quantity FROM package_templates WHERE active=true`,
    ),
    query(sql`SELECT * FROM leg_plan_crew_commitments`),
    query(
      sql`SELECT id,travel_leg_id,start_date,end_date,route_confirmed_at FROM trips`,
    ),
    query(sql`SELECT trip_id,booking_id FROM trip_stops`),
    query(sql`SELECT trip_id,resource_id FROM trip_resource_assignments`),
    query(
      sql`SELECT * FROM outreach_holds WHERE state='active' AND expires_at>${now.toISOString()}::timestamptz`,
    ),
    query(sql`SELECT * FROM leg_season_plans`),
    query(sql`SELECT * FROM leg_plan_splits`),
    query(sql`SELECT * FROM leg_plan_approval_requests`),
    query(
      sql`SELECT * FROM leg_plan_approval_decisions ORDER BY decided_at,id`,
    ),
    query(
      sql`SELECT a.*,b.enabled,b.session_version AS account_session_version FROM leg_plan_authorities a LEFT JOIN boss_accounts b ON b.id=a.account_id`,
    ),
    query(sql`SELECT * FROM leg_event_plans`),
    query(
      sql`SELECT a.leg_id,a.session_version FROM leg_manager_access a JOIN travel_legs l ON l.id=a.leg_id WHERE l.archived_at IS NULL`,
    ),
  ]);
  const obligations: PlanObligation[] = [],
    invalidIds: string[] = [];
  for (const b of bookings) {
    if (
      ![
        "confirmed",
        "contract_received",
        "deposit_received",
        "invoice_sent",
      ].includes(b.status) &&
      !(
        plans.some((p) => p.booking_id === b.id && p.committed) &&
        !["completed", "cancelled", "declined"].includes(b.status)
      )
    )
      continue;
    const input = sourceWindow(b),
      resolved = input && resolveOperationalWindow(input);
    if (!resolved || resolved.state !== "resolved") {
      invalidIds.push(b.id);
      continue;
    }
    obligations.push({
      canonicalId: b.id,
      bookingId: b.id,
      legId: b.travel_leg_id,
      window: resolved.window,
      workerIds: crews
        .filter((c) => c.booking_id === b.id)
        .map((c) => c.worker_id),
      crewWindows: crews
        .filter((c) => c.booking_id === b.id)
        .flatMap((c) => {
          const result = resolveOperationalWindow({
            startsAt: iso(c.starts_at),
            endsAt: iso(c.ends_at),
            semantics: "timestamp",
            source: "confirmed crew commitment",
          });
          return result.state === "resolved"
            ? [{ workerId: c.worker_id, window: result.window }]
            : [];
        }),
      resourceIds: [
        ...new Set(
          allocations
            .filter((a) => a.booking_id === b.id)
            .map((a) => a.resource_id),
        ),
      ],
      packageQuantities: Object.fromEntries(
        selections
          .filter((s) => s.booking_id === b.id)
          .map((s) => [s.package_template_id, 1]),
      ),
      splitGroupId: null,
    });
  }
  for (const trip of trips) {
    const linked = stops
        .filter((s) => s.trip_id === trip.id)
        .map((s) => s.booking_id),
      items = tripResources
        .filter((r) => r.trip_id === trip.id)
        .map((r) => r.resource_id);
    if (!items.length) continue;
    const resolved = resolveOperationalWindow({
      startsAt: iso(trip.start_date),
      endsAt: iso(trip.end_date),
      semantics: "timestamp",
      source: "trip",
    });
    if (resolved.state !== "resolved") {
      invalidIds.push(...linked);
      continue;
    }
    const mirror =
      linked.length === 1
        ? obligations.find((o) => o.bookingId === linked[0])
        : null;
    if (mirror) {
      mirror.resourceIds = [...new Set([...mirror.resourceIds, ...items])];
      mirror.window = {
        ...mirror.window,
        startMs: Math.min(mirror.window.startMs, resolved.window.startMs),
        endMs: Math.max(mirror.window.endMs, resolved.window.endMs),
      };
    } else
      obligations.push({
        canonicalId: `trip:${trip.id}`,
        bookingId: trip.id,
        legId: trip.travel_leg_id,
        window: resolved.window,
        workerIds: [],
        resourceIds: items,
        packageQuantities: {},
        splitGroupId: null,
        linkedBookingIds: linked,
      });
  }
  const held: PlanObligation[] = holds.flatMap((h) => {
    const result = resolveOperationalWindow({
      startsAt: String(h.starts_on).slice(0, 10),
      endsAt: String(h.ends_on).slice(0, 10),
      semantics: "inclusive_date",
      source: "active hold",
    });
    if (result.state !== "resolved") {
      invalidIds.push(h.booking_id);
      return [];
    }
    return [
      {
        canonicalId: h.booking_id,
        bookingId: h.booking_id,
        legId: h.leg_id,
        window: result.window,
        workerIds: [],
        resourceIds: h.resource_ids ?? [],
        packageQuantities: Object.fromEntries(
          Object.entries(h.quantities ?? {}).map(([code, quantity]) => [
            packages.find(
              (p) =>
                canonicalPackageCode(p.code) === canonicalPackageCode(code),
            )?.id ?? canonicalPackageCode(code),
            Number(quantity),
          ]),
        ),
        splitGroupId: null,
      },
    ];
  });
  const result: PlanFacts[] = [];
  // Other saved plans are internal evidence for group fingerprints and extra-set grants.
  const evidenceIds = [
    ...new Set([...bookingIds, ...plans.map((p) => p.booking_id)]),
  ];
  for (const id of evidenceIds) {
    const b = bookings.find((b) => b.id === id)!,
      planRow = plans.find((p) => p.booking_id === id),
      plan = planRow
        ? {
            draft: planRow.draft as PlanDraft,
            revision: Number(planRow.revision),
            committed: planRow.committed as PlanDraft | null,
          }
        : null,
      candidate = plan?.draft ?? emptyDraft(b, actor);
    const sourceReasons: string[] = [];
    const window = sourceWindow(b),
      resolved = window && resolveOperationalWindow(window),
      proposed = candidate.window && resolveOperationalWindow(candidate.window);
    if (!resolved || resolved.state !== "resolved")
      sourceReasons.push("INVALID_BOOKING_WINDOW");
    else if (
      proposed?.state === "resolved" &&
      !windowContains(proposed.window, resolved.window)
    )
      sourceReasons.push("PLAN_SHORTENS_RESERVED_WINDOW");
    if (invalidIds.length) sourceReasons.push("UNRESOLVED_OBLIGATION_WINDOWS");
    if (plan?.committed && plan.committed.legId !== b.travel_leg_id)
      sourceReasons.push("BOOKING_LEG_CHANGED");
    const publicResolved = sourceWindow({
      ...b,
      reserved_starts_at: null,
      reserved_ends_at: null,
    });
    if (
      !publicResolved ||
      resolveOperationalWindow(publicResolved).state !== "resolved"
    )
      sourceReasons.push("INVALID_PUBLIC_WINDOW");
    const season = seasons.find(
        (s) =>
          s.leg_id === candidate.legId &&
          s.season_year === candidate.seasonYear,
      ),
      split = splits.find((s) => s.id === candidate.splitGroupId);
    const branchIds = split ? [split.booking_a_id, split.booking_b_id] : [];
    const branches = await Promise.all(
      branchIds.map(
        async (bid) =>
          plans.find((p) => p.booking_id === bid)?.draft as
            PlanDraft | undefined,
      ),
    );
    const authority = authorities[0];
    const boundaryStarts = branchIds.map((bid) => {
      const row = bookings.find((b) => b.id === bid);
      return row
        ? planningStartCalendar(
            row.starts_at,
            isImportedCalendarDate(row.starts_at, row.imported_dates === true),
          )
        : null;
    });
    const december = boundaryStarts.find((p) => p?.month === 12);
    const splitSeasonYear =
      boundaryStarts.length === 2 &&
      december &&
      boundaryStarts.some(
        (p) => p?.month === 1 && p.year === december.year + 1,
      ) &&
      boundaryStarts.every(
        (p) =>
          p &&
          ((p.month === 12 && p.year === december.year) ||
            (p.month === 1 && p.year === december.year + 1)),
      )
        ? december.year
        : null;
    const seasonPlan = season
      ? legSeasonPlanSchema.parse({
          ...season.payload,
          revision: season.revision,
        })
      : null;
    const linkedStops = bookings
      .filter(
        (stop) =>
          stop.id !== id &&
          stop.travel_leg_id === candidate.legId &&
          [
            "confirmed",
            "contract_received",
            "deposit_received",
            "invoice_sent",
          ].includes(stop.status),
      )
      .map((stop) => ({ row: stop, window: sourceWindow(stop) }))
      .flatMap((stop) => {
        const resolved = stop.window && resolveOperationalWindow(stop.window);
        return resolved?.state === "resolved"
          ? [
              {
                id: stop.row.id,
                window: resolved.window,
                latitude: stop.row.latitude,
                longitude: stop.row.longitude,
              },
            ]
          : [];
      });
    const previous =
      proposed?.state === "resolved"
        ? (linkedStops
            .filter((s) => s.window.endMs <= proposed.window.startMs)
            .sort((a, b) => b.window.endMs - a.window.endMs)[0] ?? null)
        : null;
    const next =
      proposed?.state === "resolved"
        ? (linkedStops
            .filter((s) => s.window.startMs >= proposed.window.endMs)
            .sort((a, b) => a.window.startMs - b.window.startMs)[0] ?? null)
        : null;
    const endpointFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          legId: candidate.legId,
          window: candidate.window,
          base: seasonPlan?.baseAddress ?? null,
          loadInAddress: candidate.loadInAddress ?? null,
          latitude: b.latitude,
          longitude: b.longitude,
          previous,
          next,
          transport: candidate.transportResourceIds.slice().sort(),
        }),
      )
      .digest("hex");
    const verified = Boolean(
      candidate.loadInAddress &&
      seasonPlan?.baseAddress &&
      Number.isFinite(b.latitude) &&
      Number.isFinite(b.longitude) &&
      Math.abs(b.latitude) <= 90 &&
      Math.abs(b.longitude) <= 180 &&
      candidate.travelReview?.endpointFingerprint === endpointFingerprint,
    );
    result.push({
      draft: candidate,
      committed: plan?.committed ?? null,
      revision: plan?.revision ?? 0,
      booking: {
        id,
        legId: b.travel_leg_id,
        status: b.status,
        seasonYear: operationsSeason(
          b.starts_at,
          isImportedCalendarDate(b.starts_at, b.imported_dates === true),
        ),
        window,
        publicWindow: sourceWindow({
          ...b,
          reserved_starts_at: null,
          reserved_ends_at: null,
        }),
        packageIds: selections
          .filter((s) => s.booking_id === id)
          .map((s) => s.package_template_id),
      },
      season: seasonPlan,
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        rehireStatus: w.rehire_status,
      })),
      availability: availability.map((a) =>
        crewAvailabilitySchema.parse({
          ...a.payload,
          id: a.id,
          revision: a.revision,
        }),
      ),
      packageSets: sets.map((s) =>
        packageSetSchema.parse({
          ...s.payload,
          id: s.id,
          revision: s.revision,
        }),
      ),
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        status: r.status,
        minimumTransferMinutes: r.minimum_transfer_minutes,
      })),
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        code: canonicalPackageCode(p.code),
        normalCapacity: p.normal_capacity,
        unavailableQuantity: p.temporary_unavailable_quantity,
      })),
      obligations: structuredClone(obligations),
      bookingLegIds: Object.fromEntries(
        bookings.map((b) => [b.id, b.travel_leg_id ?? null]),
      ),
      holds: structuredClone(held),
      split: split
        ? {
            id: split.id,
            parentLegId: split.parent_leg_id,
            bookingIds: branchIds as [string, string],
            revision: split.revision,
          }
        : null,
      branches: branches.filter((p): p is PlanDraft => p != null),
      splitSeasonYear,
      travel: {
        endpointFingerprint,
        verified,
        source: verified ? candidate.travelReview!.source.label : null,
        verifiedAt: verified
          ? (candidate.travelReview!.reviewedAt ?? null)
          : null,
        reasons: verified ? [] : ["TRAVEL_NOT_VERIFIED"],
      },
      authority: authority
        ? { accountId: authority.account_id, revision: authority.revision }
        : null,
      authorityEnabled: authority?.enabled === true,
      authoritySessionVersion:
        authority?.account_session_version == null
          ? undefined
          : Number(authority.account_session_version),
      managerAccessVersions: Object.fromEntries(
        managerAccess.map((a) => [a.leg_id, Number(a.session_version)]),
      ),
      requests: requests
        .filter((r) => (r.booking_ids as string[]).includes(id))
        .map((r) => ({
          id: r.id,
          type: r.type,
          bookingIds: r.booking_ids,
          parentLegId: r.parent_leg_id,
          planFingerprint: r.plan_fingerprint,
          state: r.state,
          revision: r.revision,
          createdAt: iso(r.created_at)!,
        })),
      decisions: decisions.map((d) => ({
        id: d.id,
        requestId: d.request_id,
        decision: d.decision,
        reason: d.reason,
        strategicAcknowledgement: d.strategic_acknowledgement,
        actor: d.actor,
        authorityRevision: d.authority_revision,
        planFingerprint: d.plan_fingerprint,
        decidedAt: iso(d.decided_at)!,
      })),
      now: now.toISOString(),
      sourceReasons,
    });
  }
  for (const facts of result) {
    facts.approvalFingerprints = {};
    for (const request of facts.requests) {
      const group = result.filter((f) =>
        request.bookingIds.includes(f.booking.id),
      );
      if (group.length === request.bookingIds.length)
        facts.approvalFingerprints[request.id] = createHash("sha256")
          .update(group.map(planningFingerprint).sort().join(":"))
          .digest("hex");
    }
  }
  const { evaluateApprovals } = await import("./approval-policy");
  const grants: NonNullable<PlanFacts["capacityGrants"]> = [];
  for (const f of result) {
    const plan = plans.find((p) => p.booking_id === f.booking.id);
    if (
      !plan?.committed ||
      JSON.stringify(plan.committed) !== JSON.stringify(plan.draft) ||
      ["completed", "cancelled", "declined"].includes(f.booking.status)
    )
      continue;
    const a = evaluateApprovals(f),
      window = f.draft.window && resolveOperationalWindow(f.draft.window);
    if (window?.state !== "resolved") continue;
    for (const s of f.packageSets.filter(
      (s) =>
        s.classification === "extra" &&
        s.state === "verified" &&
        f.draft.packageSetIds.includes(s.id),
    )) {
      const code = f.packages.find((p) => p.id === s.packageId)?.code;
      if (
        (code === "adventure_zone" && a.extraAdventureZone) ||
        (code === "pirates_rebellion" && a.extraPirates)
      )
        grants.push({
          bookingId: f.booking.id,
          packageCode: code!,
          window: window.window,
        });
    }
  }
  for (const f of result) f.capacityGrants = grants;
  return result.filter((f) => bookingIds.includes(f.booking.id));
}
