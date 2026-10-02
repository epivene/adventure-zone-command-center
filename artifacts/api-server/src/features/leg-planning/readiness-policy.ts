import type {
  ApprovalEvaluation,
  PlanFacts,
  ReadinessDimension,
  ReadinessResult,
  ReadinessState,
} from "@workspace/api-zod";
import {
  resolveOperationalWindow,
  windowsOverlap,
  windowContains,
} from "./operational-window";
import { planningFingerprint } from "./planning-facts";
import { evaluateIntervalCapacity } from "../outreach-planner/capacity-policy";

const rank: Record<ReadinessState, number> = {
  verified_plan: 0,
  needs_details: 1,
  needs_review: 2,
  conflict: 3,
};
export function evaluatePlanReadiness(
  facts: PlanFacts,
  approvals: ApprovalEvaluation,
): ReadinessResult {
  const dimensions: ReadinessResult["dimensions"] = {
    crew: { state: "verified_plan", reasons: [] },
    equipment: { state: "verified_plan", reasons: [] },
    dates_travel: { state: "verified_plan", reasons: [] },
    accommodation: { state: "verified_plan", reasons: [] },
    approval: { state: "verified_plan", reasons: [] },
  };
  const add = (
    key: keyof typeof dimensions,
    state: ReadinessState,
    code: string,
    message: string,
  ) => {
    const d = dimensions[key];
    if (rank[state] > rank[d.state]) d.state = state;
    if (!d.reasons.some((r) => r.code === code))
      d.reasons.push({
        code,
        message,
        href:
          key === "equipment"
            ? "/settings/packages-resources"
            : `/bookings/${facts.draft.bookingId}`,
      });
  };
  const p = facts.draft,
    req = p.requirements,
    overall = p.window && resolveOperationalWindow(p.window),
    event =
      facts.booking.window && resolveOperationalWindow(facts.booking.window);
  if (!overall || overall.state !== "resolved")
    add(
      "dates_travel",
      "needs_details",
      "OPERATING_WINDOW_REQUIRED",
      "Record a valid operational reserved window.",
    );
  for (const code of facts.sourceReasons)
    add(
      "dates_travel",
      "needs_review",
      code,
      "Source dates or obligations require review.",
    );
  if (
    facts.booking.seasonYear !== p.seasonYear &&
    !(
      facts.splitSeasonYear === p.seasonYear &&
      facts.split &&
      facts.branches.length === 2 &&
      facts.branches.every(
        (b) =>
          b.seasonYear === p.seasonYear &&
          b.legId === facts.split!.parentLegId &&
          b.splitGroupId === facts.split!.id,
      )
    )
  )
    add(
      "dates_travel",
      "needs_review",
      "SEASON_MISMATCH",
      "The plan season and actual event dates need review.",
    );
  if (
    overall?.state === "resolved" &&
    event?.state === "resolved" &&
    !windowContains(overall.window, event.window)
  )
    add(
      "dates_travel",
      "needs_review",
      "PLAN_SHORTENS_RESERVED_WINDOW",
      "Preserve the full real reserved window.",
    );
  for (const phase of Object.values(p.phases)) {
    const result = resolveOperationalWindow(phase);
    if (
      result.state !== "resolved" ||
      overall?.state !== "resolved" ||
      !windowContains(overall.window, result.window)
    )
      add(
        "dates_travel",
        "needs_review",
        "PHASE_OUTSIDE_WINDOW",
        "Review arrival, setup, operating, teardown and departure dates.",
      );
  }
  if (!facts.travel.verified)
    add(
      "dates_travel",
      "needs_review",
      "TRAVEL_NOT_VERIFIED",
      "Review the current locations, neighboring stops and transfers.",
    );
  if (!facts.season || facts.season.leadership !== "confirmed")
    add(
      "crew",
      "needs_details",
      "LEADERSHIP_NOT_CONFIRMED",
      "Confirm the responsible manager for this leg and season.",
    );
  if (req.minimumCrew === null || req.roles === null)
    add(
      "crew",
      "needs_details",
      "CREW_REQUIREMENTS_REQUIRED",
      "Record minimum staffing and required roles.",
    );
  const publicEvent = facts.booking.publicWindow
    ? resolveOperationalWindow(facts.booking.publicWindow)
    : event;
  const operating = p.phases.operating
    ? resolveOperationalWindow(p.phases.operating)
    : (publicEvent ?? overall);
  if (
    operating?.state === "resolved" &&
    publicEvent?.state === "resolved" &&
    !windowContains(operating.window, publicEvent.window)
  )
    add(
      "dates_travel",
      "needs_review",
      "OPERATING_PHASE_SHORTENS_EVENT",
      "Operating coverage must include the actual public event dates.",
    );
  const confirmed = p.crew.filter((c) => c.state === "confirmed");
  for (const c of p.crew) {
    const worker = facts.workers.find((w) => w.id === c.workerId),
      shift = resolveOperationalWindow(c.window);
    if (c.state !== "confirmed")
      add(
        "crew",
        "needs_details",
        "CREW_NOT_CONFIRMED",
        "Confirm each proposed crew assignment.",
      );
    if (!worker)
      add(
        "crew",
        "needs_details",
        "WORKER_NOT_RECORDED",
        "Record the assigned worker.",
      );
    if (worker?.rehireStatus === "do_not_rehire")
      add(
        "crew",
        "conflict",
        "WORKER_NOT_REHIRABLE",
        "An assigned worker is marked do not rehire.",
      );
    if (shift.state !== "resolved") {
      add(
        "crew",
        "needs_review",
        "INVALID_CREW_WINDOW",
        "Review the crew working window.",
      );
      continue;
    }
    const availability = facts.availability
      .filter((a) => a.workerId === c.workerId)
      .map((a) => ({
        state: a.state,
        result: resolveOperationalWindow(a.window),
      }));
    if (
      availability.some(
        (a) =>
          a.state === "unavailable" &&
          a.result.state === "resolved" &&
          windowsOverlap(a.result.window, shift.window),
      )
    )
      add(
        "crew",
        "conflict",
        "WORKER_UNAVAILABLE",
        "An assigned worker is unavailable during this shift.",
      );
    let covered = shift.window.startMs;
    const intervals = availability
      .flatMap((a) =>
        a.state === "confirmed" && a.result.state === "resolved"
          ? [a.result.window]
          : [],
      )
      .sort((a, b) => a.startMs - b.startMs);
    for (const w of intervals)
      if (w.startMs <= covered) covered = Math.max(covered, w.endMs);
    if (covered < shift.window.endMs)
      add(
        "crew",
        "needs_details",
        "AVAILABILITY_NOT_CONFIRMED",
        "Confirm availability for every crew working interval.",
      );
    if (
      [...facts.obligations, ...facts.holds].some(
        (o) =>
          o.bookingId !== p.bookingId &&
          o.workerIds.includes(c.workerId) &&
          windowsOverlap(
            o.crewWindows?.find((w) => w.workerId === c.workerId)?.window ??
              o.window,
            shift.window,
          ),
      )
    )
      add(
        "crew",
        "conflict",
        "CREW_OVERLAP",
        "A crew member has another overlapping obligation.",
      );
  }
  if (
    operating?.state === "resolved" &&
    req.minimumCrew !== null &&
    req.roles !== null
  ) {
    const shifts = p.crew.flatMap((c) => {
      const result = resolveOperationalWindow(c.window);
      return result.state === "resolved"
        ? [{ ...c, window: result.window }]
        : [];
    });
    const points = [
      operating.window.startMs,
      ...shifts
        .flatMap((c) => [c.window.startMs, c.window.endMs])
        .filter(
          (t) => t > operating.window.startMs && t < operating.window.endMs,
        ),
    ];
    for (const t of points) {
      const potential = shifts.filter(
          (c) => c.window.startMs <= t && t < c.window.endMs,
        ),
        active = potential.filter((c) => c.state === "confirmed");
      const enough = (workers: typeof potential) =>
        workers.length >= req.minimumCrew! &&
        !Object.entries(req.roles!).some(
          ([role, count]) =>
            workers.filter(
              (c) => c.role.trim().toLowerCase() === role.trim().toLowerCase(),
            ).length < count,
        );
      if (!enough(active))
        add(
          "crew",
          enough(potential) ? "needs_details" : "conflict",
          "INSUFFICIENT_CREW",
          "Confirm enough crew and required roles for the operating interval.",
        );
    }
  }
  const selected = facts.packageSets.filter((s) =>
    p.packageSetIds.includes(s.id),
  );
  if (!facts.booking.packageIds.length)
    add(
      "equipment",
      "needs_details",
      "PACKAGES_REQUIRED",
      "Record the requested packages.",
    );
  if (selected.length !== p.packageSetIds.length)
    add(
      "equipment",
      "needs_details",
      "PACKAGE_SET_NOT_RECORDED",
      "Choose actual recorded equipment sets.",
    );
  for (const packageId of facts.booking.packageIds)
    if (selected.filter((s) => s.packageId === packageId).length !== 1)
      add(
        "equipment",
        "needs_details",
        "PACKAGE_SET_MISMATCH",
        "Assign one complete physical set for each selected package.",
      );
  if (selected.some((s) => !facts.booking.packageIds.includes(s.packageId)))
    add(
      "equipment",
      "needs_review",
      "UNREQUESTED_PACKAGE_SET",
      "Review equipment sets that do not match the requested packages.",
    );
  const suppliedItems = new Set<string>();
  for (const set of selected) {
    if (set.resourceIds.some((id) => suppliedItems.has(id)))
      add(
        "equipment",
        "conflict",
        "RESOURCE_OVERLAP",
        "Assign independent physical equipment to each simultaneous package set.",
      );
    for (const id of set.resourceIds) suppliedItems.add(id);
    if (
      set.state !== "verified" ||
      !set.source ||
      !Object.keys(set.requirements).length ||
      !set.resourceIds.length
    )
      add(
        "equipment",
        "needs_details",
        "COMPOSITION_NOT_VERIFIED",
        "Verify the complete real package composition and source.",
      );
    const items = facts.resources.filter((r) => set.resourceIds.includes(r.id));
    if (
      items.length !== set.resourceIds.length ||
      Object.entries(set.requirements).some(
        ([category, n]) =>
          items.filter(
            (i) =>
              i.category.trim().toLowerCase() === category.trim().toLowerCase(),
          ).length < n,
      )
    )
      add(
        "equipment",
        "needs_details",
        "INCOMPLETE_COMPOSITION",
        "The selected package set is missing required physical items.",
      );
  }
  if (req.transportRequired === null)
    add(
      "equipment",
      "needs_details",
      "TRANSPORT_REQUIREMENT_UNKNOWN",
      "Record whether transport is required.",
    );
  if (req.transportRequired && p.transportResourceIds.length === 0)
    add(
      "equipment",
      "needs_details",
      "TRANSPORT_NOT_RECORDED",
      "Assign the required vehicle, trailer or camper.",
    );
  for (const id of p.transportResourceIds) {
    const item = facts.resources.find((r) => r.id === id);
    if (
      item &&
      !/\b(vehicle|truck|van|bus|trailer|camper|rv|transport)\b/i.test(
        item.category.replaceAll("_", " "),
      )
    )
      add(
        "equipment",
        "needs_details",
        "TRANSPORT_CATEGORY_UNVERIFIED",
        "Record a verified vehicle, trailer or camper category for each selected transport item. Equipment such as a pool does not establish transport.",
      );
  }
  const resourceIds = [
    ...new Set([
      ...selected.flatMap((s) => s.resourceIds),
      ...p.transportResourceIds,
    ]),
  ];
  for (const id of resourceIds) {
    const resource = facts.resources.find((r) => r.id === id);
    if (!resource)
      add(
        "equipment",
        "needs_details",
        "RESOURCE_NOT_RECORDED",
        "Record the selected physical item.",
      );
    else if (resource.status !== "available")
      add(
        "equipment",
        "conflict",
        "RESOURCE_UNAVAILABLE",
        "A selected physical item is unavailable or under maintenance.",
      );
  }
  if (overall?.state === "resolved") {
    const declaredSplit =
      facts.split?.id === p.splitGroupId &&
      facts.split.parentLegId === p.legId &&
      facts.split.bookingIds.includes(p.bookingId)
        ? facts.split
        : null;
    const splitGranted =
      declaredSplit && approvals.splitGroupIds.includes(declaredSplit.id);
    const capacity = evaluateIntervalCapacity({
      window: overall.window,
      legId: p.legId,
      quantities: Object.fromEntries(
        facts.booking.packageIds.map((id) => [id, 1]),
      ),
      reservations: [...facts.obligations, ...facts.holds].filter(
        (o) =>
          !(o.linkedBookingIds?.includes(p.bookingId) && o.legId === p.legId),
      ),
      excludeCanonicalId: p.bookingId,
      splitBookingIds: splitGranted ? declaredSplit.bookingIds : [],
    });
    if (capacity.mirrorConflicts.length)
      add(
        "equipment",
        "needs_review",
        "CONTRADICTORY_MIRRORS",
        "Review inconsistent reservation sources.",
      );
    for (const id of capacity.legConflicts) {
      if (declaredSplit?.bookingIds.includes(id))
        add(
          "approval",
          "needs_review",
          "SPLIT_APPROVAL_PENDING",
          "Dave or the relevant leg manager must approve this exact split.",
        );
      else
        add(
          "crew",
          "conflict",
          "LEG_OVERLAP",
          "The leg has another overlapping event; record and review an eligible split.",
        );
    }
    for (const o of capacity.relevant) {
      if (o.legId === null && Object.keys(o.packageQuantities).length)
        add(
          "equipment",
          "needs_review",
          "OTHER_LEG_UNKNOWN",
          "A competing obligation has no confirmed leg.",
        );
      if (
        facts.booking.packageIds.some(
          (id) => (o.packageQuantities[id] ?? 0) > 0,
        ) &&
        !o.resourceIds.length
      )
        add(
          "equipment",
          "needs_review",
          "OTHER_EQUIPMENT_NOT_ALLOCATED",
          "Record physical equipment for the competing package obligation.",
        );
      if (o.resourceIds.some((id) => resourceIds.includes(id)))
        add(
          "equipment",
          "conflict",
          "RESOURCE_OVERLAP",
          "A selected physical item is reserved for another overlapping obligation.",
        );
    }
    for (const o of capacity.reservations) {
      if (windowsOverlap(o.window, overall.window)) continue;
      const gap =
        Math.max(
          overall.window.startMs - o.window.endMs,
          o.window.startMs - overall.window.endMs,
        ) / 60000;
      if (
        o.resourceIds.some(
          (id) =>
            resourceIds.includes(id) &&
            gap <
              (facts.resources.find((r) => r.id === id)
                ?.minimumTransferMinutes ?? 0),
        )
      )
        add(
          "equipment",
          "conflict",
          "INSUFFICIENT_TRANSFER_TIME",
          "Allow enough transfer time for the shared physical item.",
        );
    }
    for (const id of facts.booking.packageIds) {
      const pkg = facts.packages.find((pkg) => pkg.id === id);
      if (!pkg) {
        add(
          "equipment",
          "needs_details",
          "PACKAGE_CONFIGURATION_REQUIRED",
          "Record the package capacity configuration.",
        );
        continue;
      }
      const rule =
        pkg.code === "adventure_zone"
          ? 5
          : pkg.code === "pirates_rebellion"
            ? 3
            : pkg.code === "weekend_warriors"
              ? 1
              : pkg.normalCapacity;
      const normal = Math.max(
          0,
          Math.min(rule, pkg.normalCapacity) - pkg.unavailableQuantity,
        ),
        extra =
          pkg.code === "adventure_zone" || pkg.code === "pirates_rebellion"
            ? 1
            : 0;
      let granted =
        pkg.code === "adventure_zone"
          ? approvals.extraAdventureZone
          : pkg.code === "pirates_rebellion"
            ? approvals.extraPirates
            : false;
      const used = capacity.peak[id] ?? 1;
      if (!granted && used > normal && overall.state === "resolved") {
        const grants = (facts.capacityGrants ?? []).filter(
          (g) => g.packageCode === pkg.code && g.bookingId !== p.bookingId,
        );
        const points = [
          overall.window.startMs,
          ...capacity.reservations.flatMap((o) => [
            o.window.startMs,
            o.window.endMs,
          ]),
          ...grants.flatMap((g) => [g.window.startMs, g.window.endMs]),
        ].filter(
          (t) => t >= overall.window.startMs && t < overall.window.endMs,
        );
        granted = points.every((t) => {
          const active = capacity.reservations.filter(
            (o) => o.window.startMs <= t && t < o.window.endMs,
          );
          const demand =
            1 +
            active.reduce((sum, o) => sum + (o.packageQuantities[id] ?? 0), 0);
          return (
            demand <= normal ||
            grants.some(
              (g) =>
                g.window.startMs <= t &&
                t < g.window.endMs &&
                active.some((o) => o.bookingId === g.bookingId),
            )
          );
        });
      }
      const usesExtra = selected.some(
        (s) => s.packageId === id && s.classification === "extra",
      );
      if (
        usesExtra &&
        !(pkg.code === "adventure_zone"
          ? approvals.extraAdventureZone
          : pkg.code === "pirates_rebellion"
            ? approvals.extraPirates
            : false)
      )
        add(
          "approval",
          "needs_review",
          "EXTRA_SET_APPROVAL_REQUIRED",
          "Dave must approve this additional physical set and staffing plan.",
        );
      if (normal === 0 && !extra)
        add(
          "equipment",
          "needs_details",
          "CAPACITY_NOT_VERIFIED",
          "Verify usable package capacity.",
        );
      else if (used > normal + extra)
        add(
          "equipment",
          "conflict",
          "PACKAGE_CAPACITY_EXCEEDED",
          "The simultaneous package demand exceeds the permitted physical capacity.",
        );
      else if (used > normal && !granted)
        add(
          "approval",
          "needs_review",
          pkg.code === "adventure_zone"
            ? "EXTRA_ADVENTURE_ZONE_APPROVAL_PENDING"
            : "EXTRA_PIRATES_APPROVAL_PENDING",
          "Dave must approve the additional complete set and staffing plan.",
        );
    }
  }
  if (req.lodging === "unknown")
    add(
      "accommodation",
      "needs_details",
      "LODGING_REQUIREMENT_UNKNOWN",
      "Record accommodation requirements.",
    );
  if (req.lodging === "unnecessary" && !req.lodgingReason)
    add(
      "accommodation",
      "needs_details",
      "LODGING_REASON_REQUIRED",
      "Record why accommodation is unnecessary.",
    );
  if (req.lodging === "required") {
    const valid = p.lodging.flatMap((l) => {
      const result = resolveOperationalWindow(l.window);
      return l.source && l.location && result.state === "resolved"
        ? [{ ...l, window: result.window }]
        : [];
    });
    const points =
      overall?.state === "resolved"
        ? [
            overall.window.startMs,
            ...valid
              .flatMap((l) => [l.window.startMs, l.window.endMs])
              .filter(
                (t) => t > overall.window.startMs && t < overall.window.endMs,
              ),
          ]
        : [];
    if (
      !points.length ||
      points.some(
        (t) =>
          valid
            .filter((l) => l.window.startMs <= t && t < l.window.endMs)
            .reduce((sum, l) => sum + l.capacity, 0) < confirmed.length,
      )
    )
      add(
        "accommodation",
        "needs_details",
        "LODGING_NOT_CONFIRMED",
        "Record sourced accommodation covering the crew and reserved dates.",
      );
  }
  if (approvals.state !== "passed")
    for (const code of approvals.reasons.length
      ? approvals.reasons
      : ["APPROVAL_REVIEW_REQUIRED"])
      add(
        "approval",
        "needs_review",
        code,
        "Review the required decision for this exact plan.",
      );
  const overallState = Object.values(dimensions).reduce<ReadinessState>(
    (state, d) => (rank[d.state] > rank[state] ? d.state : state),
    "verified_plan",
  );
  return {
    overall: overallState,
    dimensions,
    evaluatedAt: facts.now,
    factsFingerprint: planningFingerprint(facts),
  };
}
