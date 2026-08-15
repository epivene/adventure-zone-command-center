import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  DrizzleRoutingCacheStore,
  OsrmRoutingProvider,
  RoutingEstimator,
  type LatLng,
} from "@/features/trips/routing";
import { DrizzleTripRepository, type TripStopRecord } from "@/features/trips/trip-repository";
import { scoreHandoff, type HandoffScore } from "./handoff-scoring";
import {
  HandoffRepository,
  type EquipmentHandoff,
  type HandoffSuggestionInput,
} from "./handoff-repository";

type DrizzleDatabase = typeof database;

type AssignmentRow = {
  tripId: string;
  travelLegId: string;
  tripName: string;
  startDate: Date;
  endDate: Date;
  startLabel: string;
  startLatitude: number | null;
  startLongitude: number | null;
  endLabel: string;
  endLatitude: number | null;
  endLongitude: number | null;
  updatedAt: Date;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  minimumTransferMinutes: number;
};

type Anchor = {
  label: string;
  point: LatLng;
  bookingId: string | null;
};

type MeetupCandidate = {
  label: string;
  point: LatLng;
};

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 60_000);
}

function fingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function anchorFromStop(stop: TripStopRecord): Anchor | null {
  if (stop.latitude === null || stop.longitude === null) return null;
  return {
    label: `${stop.bookingName} (${stop.city}, ${stop.region})`,
    point: { latitude: stop.latitude, longitude: stop.longitude },
    bookingId: stop.bookingId,
  };
}

function tripEndpoint(row: AssignmentRow, side: "start" | "end"): Anchor | null {
  const latitude = side === "start" ? row.startLatitude : row.endLatitude;
  const longitude = side === "start" ? row.startLongitude : row.endLongitude;
  const label = side === "start" ? row.startLabel : row.endLabel;
  if (latitude === null || longitude === null) return null;
  return { label, point: { latitude, longitude }, bookingId: null };
}

class NominatimMeetupFinder {
  constructor(
    private readonly baseUrl = process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    private readonly timeoutMs = 8_000,
  ) {}

  async reverse(point: LatLng): Promise<MeetupCandidate | null> {
    const url = new URL("/reverse", this.baseUrl);
    url.searchParams.set("lat", String(point.latitude));
    url.searchParams.set("lon", String(point.longitude));
    url.searchParams.set("format", "json");
    url.searchParams.set("zoom", "10");
    try {
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "User-Agent": "adventure-zone-command-center/1.0", Accept: "application/json" },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        display_name?: string;
        lat?: string;
        lon?: string;
        address?: Record<string, string | undefined>;
      };
      const latitude = Number(body.lat ?? point.latitude);
      const longitude = Number(body.lon ?? point.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const place =
        body.address?.city ??
        body.address?.town ??
        body.address?.village ??
        body.address?.municipality ??
        body.address?.county ??
        body.display_name;
      if (!place) return null;
      const region = body.address?.state;
      return {
        label: region && !place.includes(region) ? `${place}, ${region}` : place,
        point: { latitude, longitude },
      };
    } catch {
      return null;
    }
  }

  async findBetween(a: Anchor, b: Anchor): Promise<MeetupCandidate[]> {
    const candidates: MeetupCandidate[] = [
      { label: a.label, point: a.point },
      { label: b.label, point: b.point },
    ];
    for (const fraction of [0.33, 0.5, 0.67]) {
      const raw = {
        latitude: a.point.latitude + (b.point.latitude - a.point.latitude) * fraction,
        longitude: a.point.longitude + (b.point.longitude - a.point.longitude) * fraction,
      };
      const resolved = await this.reverse(raw);
      candidates.push(
        resolved ?? {
          label: `Between ${a.label} and ${b.label}`,
          point: raw,
        },
      );
    }
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = `${candidate.label.toLowerCase()}|${candidate.point.latitude.toFixed(3)}|${candidate.point.longitude.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

export type HandoffPreview = {
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  fromTravelMiles: number;
  fromTravelMinutes: number;
  toTravelMiles: number;
  toTravelMinutes: number;
  addedDetourMiles: number;
  availableBufferMinutes: number;
  band: "strong" | "possible" | "weak" | "infeasible";
  score: number;
  reasons: string[];
};

export class HandoffService {
  private readonly repository: HandoffRepository;
  private readonly tripRepository: DrizzleTripRepository;
  private readonly estimator: RoutingEstimator;
  private readonly meetupFinder = new NominatimMeetupFinder();

  constructor(private readonly database: DrizzleDatabase) {
    this.repository = new HandoffRepository(database);
    this.tripRepository = new DrizzleTripRepository(database);
    this.estimator = new RoutingEstimator(
      new OsrmRoutingProvider(),
      new DrizzleRoutingCacheStore(database),
    );
  }

  async list(year: number): Promise<EquipmentHandoff[]> {
    return this.repository.listForSeason(year);
  }

  private async assignments(year: number): Promise<AssignmentRow[]> {
    const result = await this.database.execute(sql`
      select t.id as "tripId", t.travel_leg_id as "travelLegId", t.name as "tripName",
        t.start_date as "startDate", t.end_date as "endDate",
        t.start_label as "startLabel", t.start_latitude as "startLatitude", t.start_longitude as "startLongitude",
        t.end_label as "endLabel", t.end_latitude as "endLatitude", t.end_longitude as "endLongitude",
        t.updated_at as "updatedAt",
        r.id as "resourceId", r.code as "resourceCode", r.name as "resourceName",
        r.minimum_transfer_minutes as "minimumTransferMinutes"
      from trip_resource_assignments tra
      join trips t on t.id = tra.trip_id
      join resources r on r.id = tra.resource_id
      where r.movable = true
        and extract(year from t.start_date) <= ${year}
        and extract(year from t.end_date) >= ${year}
      order by r.id, t.start_date, t.id
    `);
    return rows<AssignmentRow>(result);
  }

  private async anchors(row: AssignmentRow, side: "release" | "receive"): Promise<Anchor | null> {
    const stops = await this.tripRepository.listStops(row.tripId);
    const ordered = side === "release" ? [...stops].reverse() : stops;
    for (const stop of ordered) {
      const anchor = anchorFromStop(stop);
      if (anchor) return anchor;
    }
    return side === "release" ? tripEndpoint(row, "end") : tripEndpoint(row, "start");
  }

  private async evaluateCandidate(input: {
    from: AssignmentRow;
    to: AssignmentRow;
    fromAnchor: Anchor;
    toAnchor: Anchor;
    candidate: MeetupCandidate;
    windowStartsAt: Date;
    windowEndsAt: Date;
  }): Promise<{ preview: HandoffPreview; score: HandoffScore } | null> {
    const direct = await this.estimator.estimate(input.fromAnchor.point, input.toAnchor.point, { preferLive: false });
    const fromTravel = await this.estimator.estimate(input.fromAnchor.point, input.candidate.point, { preferLive: false });
    const toTravel = await this.estimator.estimate(input.candidate.point, input.toAnchor.point, { preferLive: false });
    if (!direct || !fromTravel || !toTravel) return null;

    const baselineHalfMiles = direct.miles / 2;
    const baselineHalfMinutes = direct.minutes / 2;
    const fromDetourMiles = Math.max(0, fromTravel.miles - baselineHalfMiles);
    const toDetourMiles = Math.max(0, toTravel.miles - baselineHalfMiles);
    const fromDetourMinutes = Math.max(0, fromTravel.minutes - baselineHalfMinutes);
    const toDetourMinutes = Math.max(0, toTravel.minutes - baselineHalfMinutes);
    const availableBufferMinutes = minutesBetween(input.windowStartsAt, input.windowEndsAt);
    const score = scoreHandoff({
      directMiles: direct.miles,
      directMinutes: direct.minutes,
      fromDetourMiles,
      fromDetourMinutes,
      toDetourMiles,
      toDetourMinutes,
      availableBufferMinutes,
      minimumTransferMinutes: input.from.minimumTransferMinutes,
      equipmentReady: input.from.endDate <= input.to.startDate,
    });
    return {
      score,
      preview: {
        meetupLabel: input.candidate.label,
        meetupLatitude: input.candidate.point.latitude,
        meetupLongitude: input.candidate.point.longitude,
        fromTravelMiles: fromTravel.miles,
        fromTravelMinutes: fromTravel.minutes,
        toTravelMiles: toTravel.miles,
        toTravelMinutes: toTravel.minutes,
        addedDetourMiles: fromDetourMiles + toDetourMiles,
        availableBufferMinutes,
        band: score.band,
        score: score.score,
        reasons: score.reasons,
      },
    };
  }

  async recalculate(year: number): Promise<EquipmentHandoff[]> {
    const assignments = await this.assignments(year);
    const byResource = new Map<string, AssignmentRow[]>();
    for (const assignment of assignments) {
      byResource.set(assignment.resourceId, [...(byResource.get(assignment.resourceId) ?? []), assignment]);
    }

    const refreshedFingerprints: string[] = [];
    for (const resourceAssignments of byResource.values()) {
      resourceAssignments.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      for (let index = 0; index < resourceAssignments.length - 1; index += 1) {
        const from = resourceAssignments[index]!;
        const to = resourceAssignments[index + 1]!;
        if (from.travelLegId === to.travelLegId) continue;
        if (from.endDate > to.startDate) continue;

        const [fromAnchor, toAnchor] = await Promise.all([
          this.anchors(from, "release"),
          this.anchors(to, "receive"),
        ]);
        if (!fromAnchor || !toAnchor) continue;

        const candidates = await this.meetupFinder.findBetween(fromAnchor, toAnchor);
        const evaluated = (
          await Promise.all(
            candidates.map((candidate) =>
              this.evaluateCandidate({
                from,
                to,
                fromAnchor,
                toAnchor,
                candidate,
                windowStartsAt: from.endDate,
                windowEndsAt: to.startDate,
              }),
            ),
          )
        ).filter((value): value is NonNullable<typeof value> => Boolean(value));
        const feasible = evaluated.filter((value) => value.score.band !== "infeasible");
        feasible.sort(
          (a, b) => b.score.score - a.score.score || a.preview.addedDetourMiles - b.preview.addedDetourMiles,
        );
        const best = feasible[0];
        if (!best || best.score.band === "infeasible") continue;

        const dependencyFingerprint = fingerprint([
          from.resourceId,
          from.tripId,
          to.tripId,
          from.updatedAt.toISOString(),
          to.updatedAt.toISOString(),
          fromAnchor.point,
          toAnchor.point,
        ]);
        refreshedFingerprints.push(dependencyFingerprint);
        const explanation = [
          `${from.resourceName} can move from ${from.tripName} to ${to.tripName}.`,
          ...best.score.reasons,
          `Suggested meetup: ${best.preview.meetupLabel}.`,
        ].join(" ");
        const input: HandoffSuggestionInput = {
          fromLegId: from.travelLegId,
          toLegId: to.travelLegId,
          fromTripId: from.tripId,
          toTripId: to.tripId,
          resourceId: from.resourceId,
          meetupLabel: best.preview.meetupLabel,
          meetupLatitude: best.preview.meetupLatitude,
          meetupLongitude: best.preview.meetupLongitude,
          windowStartsAt: from.endDate,
          windowEndsAt: to.startDate,
          directMiles: best.preview.fromTravelMiles + best.preview.toTravelMiles,
          directMinutes: best.preview.fromTravelMinutes + best.preview.toTravelMinutes,
          fromDetourMiles: Math.max(0, best.preview.fromTravelMiles - (best.preview.fromTravelMiles + best.preview.toTravelMiles) / 2),
          fromDetourMinutes: Math.max(0, best.preview.fromTravelMinutes - (best.preview.fromTravelMinutes + best.preview.toTravelMinutes) / 2),
          toDetourMiles: Math.max(0, best.preview.toTravelMiles - (best.preview.fromTravelMiles + best.preview.toTravelMiles) / 2),
          toDetourMinutes: Math.max(0, best.preview.toTravelMinutes - (best.preview.fromTravelMinutes + best.preview.toTravelMinutes) / 2),
          combinedDetourMiles: best.preview.addedDetourMiles,
          availableBufferMinutes: best.preview.availableBufferMinutes,
          opportunityBand: best.score.band,
          explanation,
          dependencyFingerprint,
        };
        await this.repository.upsertSuggestion(input);
      }
    }

    await this.repository.markUnrefreshedNeedsReview(year, refreshedFingerprints);
    return this.repository.listForSeason(year);
  }

  async preview(id: string, input: {
    meetupLabel: string;
    latitude: number;
    longitude: number;
    windowStartsAt?: Date;
    windowEndsAt?: Date;
  }): Promise<HandoffPreview | null> {
    const existing = await this.repository.get(id);
    if (!existing || !existing.fromTripId || !existing.toTripId) return null;
    const assignments = await this.assignments(existing.windowStartsAt.getUTCFullYear());
    const from = assignments.find((item) => item.tripId === existing.fromTripId && item.resourceId === existing.resourceId);
    const to = assignments.find((item) => item.tripId === existing.toTripId && item.resourceId === existing.resourceId);
    if (!from || !to) return null;
    const [fromAnchor, toAnchor] = await Promise.all([this.anchors(from, "release"), this.anchors(to, "receive")]);
    if (!fromAnchor || !toAnchor) return null;
    const evaluated = await this.evaluateCandidate({
      from,
      to,
      fromAnchor,
      toAnchor,
      candidate: { label: input.meetupLabel, point: { latitude: input.latitude, longitude: input.longitude } },
      windowStartsAt: input.windowStartsAt ?? existing.windowStartsAt,
      windowEndsAt: input.windowEndsAt ?? existing.windowEndsAt,
    });
    return evaluated?.preview ?? null;
  }
}
