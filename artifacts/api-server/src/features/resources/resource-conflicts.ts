import { businessDayBounds } from "@/lib/business-date";

import type {
  ResourceReservation,
  ResourceWarning,
  ResourceWarningCode,
} from "./resource-types";

export interface TransferTimeLookup {
  estimateMinutes(
    from: ResourceReservation,
    to: ResourceReservation,
  ): Promise<{ minutes: number; source: "live" | "cached" | "manual" } | null>;
}

type OccupiedReservation = {
  reservation: ResourceReservation;
  startsAt: Date;
  endsAt: Date;
};

const warningOrder: Record<ResourceWarningCode, number> = {
  ATTRACTION_TOTAL_MISMATCH: 0,
  RESOURCE_UNAVAILABLE: 1,
  RESOURCE_DATE_EVIDENCE_UNRESOLVED: 1,
  RESOURCE_OVERLAP: 2,
  RESOURCE_LOCATION_UNKNOWN: 3,
  TRANSFER_TRIP_MISSING: 4,
  PAINTBALL_TRANSFER_TIME: 5,
};

function occupiedWindow(
  reservation: ResourceReservation,
): OccupiedReservation | null {
  if (reservation.dateProvenance?.evidenceState === 'needs_review') return null;
  if (reservation.dateProvenance && (!reservation.startsAt || !reservation.endsAt)) return null;
  if (!reservation.startsAt) return null;
  const startDay = businessDayBounds(reservation.startsAt);
  const endReference =
    reservation.endsAt &&
    reservation.endsAt.getTime() >= reservation.startsAt.getTime()
      ? reservation.endsAt
      : reservation.startsAt;
  const endDay = businessDayBounds(endReference);
  return {
    reservation,
    startsAt: new Date(
      startDay.start.getTime() - reservation.setupMinutes * 60_000,
    ),
    endsAt: new Date(
      endDay.end.getTime() + reservation.teardownMinutes * 60_000,
    ),
  };
}

function occupiedTimeFingerprint(occupied: OccupiedReservation): string {
  return [
    occupied.reservation.assignmentId,
    occupied.startsAt.toISOString(),
    occupied.endsAt.toISOString(),
  ].join("@");
}

function transferFingerprint(occupied: OccupiedReservation): string {
  const { reservation } = occupied;
  const location = reservation.location
    ? `${reservation.location.latitude},${reservation.location.longitude}`
    : "unknown";
  return [
    occupiedTimeFingerprint(occupied),
    location,
  ].join("@");
}

function conflictKey(input: {
  code: ResourceWarningCode;
  resourceId: string | null;
  assignmentIds: readonly string[];
  fingerprint: readonly string[];
}): string {
  return [
    `code=${input.code}`,
    `resource=${input.resourceId ?? "booking"}`,
    `assignments=${[...input.assignmentIds].sort().join(",")}`,
    `fingerprint=${[...input.fingerprint].sort().join(";")}`,
  ].join("|");
}

function warning(input: {
  code: ResourceWarningCode;
  resourceId: string | null;
  assignmentIds: readonly string[];
  fingerprint: readonly string[];
  message: string;
}): ResourceWarning {
  const assignmentIds = [...new Set(input.assignmentIds)].sort();
  return {
    code: input.code,
    conflictKey: conflictKey({ ...input, assignmentIds }),
    resourceId: input.resourceId,
    assignmentIds,
    message: input.message,
    overridden: false,
    override: null,
  };
}

function overlaps(first: OccupiedReservation, second: OccupiedReservation) {
  return (
    first.startsAt.getTime() < second.endsAt.getTime() &&
    second.startsAt.getTime() < first.endsAt.getTime()
  );
}

function finiteLocation(reservation: ResourceReservation) {
  return (
    reservation.location !== null &&
    Number.isFinite(reservation.location.latitude) &&
    Number.isFinite(reservation.location.longitude) &&
    reservation.location.latitude >= -90 &&
    reservation.location.latitude <= 90 &&
    reservation.location.longitude >= -180 &&
    reservation.location.longitude <= 180
  );
}

function directTransitions(
  occupied: readonly OccupiedReservation[],
): Array<readonly [OccupiedReservation, OccupiedReservation]> {
  const first = occupied[0];
  if (!first) return [];

  const clusters: Array<{
    reservations: OccupiedReservation[];
    startsAt: Date;
    endsAt: Date;
  }> = [{
    reservations: [first],
    startsAt: first.startsAt,
    endsAt: first.endsAt,
  }];
  for (const candidate of occupied.slice(1)) {
    const cluster = clusters.at(-1)!;
    if (candidate.startsAt.getTime() < cluster.endsAt.getTime()) {
      cluster.reservations.push(candidate);
      if (candidate.endsAt.getTime() > cluster.endsAt.getTime()) {
        cluster.endsAt = candidate.endsAt;
      }
      continue;
    }
    clusters.push({
      reservations: [candidate],
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
    });
  }

  const transitions: Array<
    readonly [OccupiedReservation, OccupiedReservation]
  > = [];
  for (let index = 0; index < clusters.length - 1; index += 1) {
    const fromCluster = clusters[index]!;
    const toCluster = clusters[index + 1]!;
    const exits = fromCluster.reservations
      .filter(
        ({ endsAt }) => endsAt.getTime() === fromCluster.endsAt.getTime(),
      )
      .sort((firstExit, secondExit) =>
        firstExit.reservation.assignmentId.localeCompare(
          secondExit.reservation.assignmentId,
        ),
      );
    const entries = toCluster.reservations
      .filter(
        ({ startsAt }) => startsAt.getTime() === toCluster.startsAt.getTime(),
      )
      .sort((firstEntry, secondEntry) =>
        firstEntry.reservation.assignmentId.localeCompare(
          secondEntry.reservation.assignmentId,
        ),
      );
    for (const exit of exits) {
      for (const entry of entries) {
        transitions.push([exit, entry]);
      }
    }
  }
  return transitions;
}

function groupedByResource(
  reservations: readonly ResourceReservation[],
): Map<string, ResourceReservation[]> {
  const groups = new Map<string, ResourceReservation[]>();
  for (const reservation of reservations) {
    const group = groups.get(reservation.resourceId) ?? [];
    group.push(reservation);
    groups.set(reservation.resourceId, group);
  }
  return groups;
}

export async function detectResourceConflicts(input: {
  reservations: readonly ResourceReservation[];
  physicalAttractionTotal: number | null;
  assignedAttractionCount: number;
  transferTimeLookup: TransferTimeLookup;
}): Promise<ResourceWarning[]> {
  const warnings: ResourceWarning[] = [];
  const countedReservations = input.reservations.filter(
    ({ countsAsAttraction }) => countsAsAttraction,
  );

  if (
    input.physicalAttractionTotal !== null &&
    input.physicalAttractionTotal !== input.assignedAttractionCount
  ) {
    warnings.push(
      warning({
        code: "ATTRACTION_TOTAL_MISMATCH",
        resourceId: null,
        assignmentIds: countedReservations.map(
          ({ assignmentId }) => assignmentId,
        ),
        fingerprint: [
          `physical=${input.physicalAttractionTotal}`,
          `assigned=${input.assignedAttractionCount}`,
          `resources=${[
            ...new Set(countedReservations.map(({ resourceId }) => resourceId)),
          ]
            .sort()
            .join(",")}`,
        ],
        message:
          `The saved physical total is ${input.physicalAttractionTotal}, but ` +
          `${input.assignedAttractionCount} attraction resources are assigned.`,
      }),
    );
  }

  for (const [resourceId, group] of [
    ...groupedByResource(input.reservations).entries(),
  ].sort(([first], [second]) => first.localeCompare(second))) {
    const orderedGroup = [...group].sort((first, second) =>
      first.assignmentId.localeCompare(second.assignmentId),
    );
    for (const unavailable of orderedGroup.filter(
      ({ resourceStatus }) => resourceStatus !== "available",
    )) {
      warnings.push(
        warning({
          code: "RESOURCE_UNAVAILABLE",
          resourceId,
          assignmentIds: [unavailable.assignmentId],
          fingerprint: [
            `status=${unavailable.resourceStatus}`,
            `resource=${unavailable.resourceCode}`,
          ],
          message: `${unavailable.resourceName} is ${unavailable.resourceStatus}.`,
        }),
      );
    }

    const unresolved = orderedGroup.filter(r=>r.dateProvenance?.evidenceState === "needs_review");
    if(unresolved.length) warnings.push(warning({
      code:"RESOURCE_DATE_EVIDENCE_UNRESOLVED",resourceId,
      assignmentIds:orderedGroup.map(r=>r.assignmentId),
      fingerprint:unresolved.map(r=>`${r.bookingId}:${JSON.stringify(r.dateProvenance)}`),
      message:`${orderedGroup[0].resourceName} has a booking with unresolved date evidence. Review its public and reservation sources before claiming availability.`,
    }));
    const occupied = orderedGroup
      .map(occupiedWindow)
      .filter((item): item is OccupiedReservation => item !== null)
      .sort(
        (first, second) =>
          first.startsAt.getTime() - second.startsAt.getTime() ||
          first.reservation.assignmentId.localeCompare(
            second.reservation.assignmentId,
          ),
      );

    for (let firstIndex = 0; firstIndex < occupied.length; firstIndex += 1) {
      const first = occupied[firstIndex]!;
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < occupied.length;
        secondIndex += 1
      ) {
        const second = occupied[secondIndex]!;
        if (!overlaps(first, second)) continue;
        warnings.push(
          warning({
            code: "RESOURCE_OVERLAP",
            resourceId,
            assignmentIds: [
              first.reservation.assignmentId,
              second.reservation.assignmentId,
            ],
            fingerprint: [
              occupiedTimeFingerprint(first),
              occupiedTimeFingerprint(second),
            ],
            message:
              `${first.reservation.resourceName} is occupied by ` +
              `${first.reservation.bookingName} and ${second.reservation.bookingName} ` +
              "during overlapping setup, event, or teardown windows.",
          }),
        );
      }
    }

    if (orderedGroup[0]?.resourceCode !== "paintball_trailer") continue;
    for (const [from, to] of directTransitions(occupied)) {
      const assignmentIds = [
        from.reservation.assignmentId,
        to.reservation.assignmentId,
      ];
      const baseFingerprint = [
        transferFingerprint(from),
        transferFingerprint(to),
      ];
      if (
        !finiteLocation(from.reservation) ||
        !finiteLocation(to.reservation)
      ) {
        warnings.push(
          warning({
            code: "RESOURCE_LOCATION_UNKNOWN",
            resourceId,
            assignmentIds,
            fingerprint: baseFingerprint,
            message:
              "Paintball transfer time cannot be checked until both booking locations are known.",
          }),
        );
        continue;
      }

      const estimate = await input.transferTimeLookup.estimateMinutes(
        from.reservation,
        to.reservation,
      );
      if (
        !estimate ||
        !Number.isFinite(estimate.minutes) ||
        estimate.minutes < 0
      ) {
        warnings.push(
          warning({
            code: "TRANSFER_TRIP_MISSING",
            resourceId,
            assignmentIds,
            fingerprint: baseFingerprint,
            message:
              "Paintball transfer time cannot be checked until a route or trip estimate exists.",
          }),
        );
        continue;
      }

      const minimumTransferMinutes = Math.max(
        from.reservation.minimumTransferMinutes,
        to.reservation.minimumTransferMinutes,
      );
      const requiredMinutes = Math.max(
        minimumTransferMinutes,
        estimate.minutes,
      );
      const gapMinutes =
        (to.startsAt.getTime() - from.endsAt.getTime()) / 60_000;
      if (gapMinutes < requiredMinutes) {
        warnings.push(
          warning({
            code: "PAINTBALL_TRANSFER_TIME",
            resourceId,
            assignmentIds,
            fingerprint: [
              ...baseFingerprint,
              `floor=${minimumTransferMinutes}`,
              `route=${estimate.minutes}`,
            ],
            message:
              `Paintball has ${Math.max(0, Math.floor(gapMinutes))} minutes ` +
              `between occupied windows but needs ${requiredMinutes} minutes.`,
          }),
        );
      }
    }
  }

  return warnings.sort(
    (first, second) =>
      warningOrder[first.code] - warningOrder[second.code] ||
      first.conflictKey.localeCompare(second.conflictKey),
  );
}
