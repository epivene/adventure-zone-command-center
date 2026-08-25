import { PostgresLeadScoutCrmSearch, type LeadScoutCrmSearch } from "./lead-scout-crm-search";
import { LeadScoutRepository } from "./lead-scout-repository";
import { ScoutAreaResolver, ScoutGeocoder, type ScoutSearchPlace } from "./scout-geography";
import type { LeadDiscoveryCriteria, LeadScoutRunView } from "./lead-scout-types";

export type ScoutEventCategory =
  | "fair"
  | "festival"
  | "rodeo"
  | "powwow"
  | "community_celebration"
  | "car_show"
  | "expo_show"
  | "parade"
  | "other_family_community";

export type ScoutHistoryFilter = "all" | "hide_booked" | "hide_booked_and_dismissed";

export type RadiusScoutAnchorInput = {
  kind: "booking" | "event_family" | "manual" | "candidate";
  recordId?: string;
  label: string;
  city?: string;
  region?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};

export type RadiusScoutRequest = {
  anchor: RadiusScoutAnchorInput;
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: ScoutHistoryFilter;
};

export type RadiusScoutScope = {
  mode: "radius";
  anchor: RadiusScoutAnchorInput & { latitude: number; longitude: number };
  radiusMiles: RadiusScoutRequest["radiusMiles"];
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: ScoutHistoryFilter;
  searchPlaces: Array<Pick<ScoutSearchPlace, "name" | "placeType" | "distanceMiles">>;
  searchAreaIncomplete: boolean;
};

type RadiusCriteria = LeadDiscoveryCriteria & { radiusScope: RadiusScoutScope };

type Repository = Pick<LeadScoutRepository, "createRun" | "setCriteria" | "setCrmReady" | "getRun" | "setFailed">;
type Geocoder = Pick<ScoutGeocoder, "resolve">;
type AreaResolver = Pick<ScoutAreaResolver, "listPlaces">;

function manualCityRegion(anchor: RadiusScoutAnchorInput) {
  if (anchor.city?.trim() || anchor.region?.trim()) {
    return { city: anchor.city?.trim() || null, region: anchor.region?.trim().toUpperCase() || null };
  }
  const match = anchor.label.trim().match(/^(.+?),\s*([A-Za-z]{2})$/);
  return match
    ? { city: match[1]?.trim() || null, region: match[2]?.toUpperCase() || null }
    : { city: anchor.label.trim() || null, region: null };
}

function categoryKeywords(categories: ScoutEventCategory[]) {
  const labels: Record<ScoutEventCategory, string> = {
    fair: "fair",
    festival: "festival",
    rodeo: "rodeo",
    powwow: "powwow",
    community_celebration: "community celebration",
    car_show: "car show",
    expo_show: "expo show",
    parade: "parade",
    other_family_community: "family community event",
  };
  return categories.map((category) => labels[category]);
}

function uniqueNames(values: string[], limit: number) {
  const names = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!names.has(key)) names.set(key, trimmed);
    if (names.size >= limit) break;
  }
  return [...names.values()];
}

export class RadiusLeadScoutService {
  constructor(
    private readonly repository: Repository = new LeadScoutRepository(),
    private readonly crmSearch: LeadScoutCrmSearch = new PostgresLeadScoutCrmSearch(),
    private readonly geocoder: Geocoder = new ScoutGeocoder(),
    private readonly areaResolver: AreaResolver = new ScoutAreaResolver(),
  ) {}

  async create(input: { actorId: string; request: RadiusScoutRequest }): Promise<LeadScoutRunView> {
    const { city, region } = manualCityRegion(input.request.anchor);
    let latitude = input.request.anchor.latitude;
    let longitude = input.request.anchor.longitude;
    if (latitude === undefined || longitude === undefined) {
      const query = input.request.anchor.address?.trim()
        || [city, region].filter(Boolean).join(", ")
        || input.request.anchor.label;
      const resolved = await this.geocoder.resolve(query);
      if (!resolved) throw new Error("SCOUT_ANCHOR_NOT_RESOLVED");
      latitude = resolved.latitude;
      longitude = resolved.longitude;
    }

    let searchPlaces: ScoutSearchPlace[] = [];
    let searchAreaIncomplete = false;
    try {
      searchPlaces = await this.areaResolver.listPlaces({ latitude, longitude }, input.request.radiusMiles);
    } catch {
      searchAreaIncomplete = true;
    }
    const searchCities = uniqueNames([
      ...(city ? [city] : []),
      ...searchPlaces.filter((place) => place.placeType !== "county").map((place) => place.name),
    ], 120);
    const searchCounties = uniqueNames(
      searchPlaces.filter((place) => place.placeType === "county").map((place) => place.name),
      60,
    );

    const scope: RadiusScoutScope = {
      mode: "radius",
      anchor: {
        ...input.request.anchor,
        city: city ?? undefined,
        region: region ?? undefined,
        latitude,
        longitude,
      },
      radiusMiles: input.request.radiusMiles,
      dateStart: input.request.dateStart,
      dateEnd: input.request.dateEnd,
      categories: input.request.categories,
      historyFilter: input.request.historyFilter,
      searchPlaces: searchPlaces.map((place) => ({
        name: place.name,
        placeType: place.placeType,
        distanceMiles: Math.round(place.distanceMiles * 10) / 10,
      })),
      searchAreaIncomplete,
    };
    const criteria: RadiusCriteria = {
      originalQuestion: `Scout ${input.request.radiusMiles} miles around ${input.request.anchor.label}`,
      dateFrom: input.request.dateStart,
      dateThrough: input.request.dateEnd,
      month: null,
      year: Number(input.request.dateStart.slice(0, 4)) || null,
      regions: [],
      cities: searchCities,
      geoMode: "radius",
      routeId: null,
      legId: null,
      eventKeywords: [
        ...categoryKeywords(input.request.categories),
        `within ${input.request.radiusMiles} miles of ${input.request.anchor.label}`,
        ...searchCounties.slice(0, 40).map((county) => `${county} events`),
      ],
      fitIntent: "either",
      radiusScope: scope,
    };
    const coverageParts = [
      searchCities.length ? `${searchCities.length} communities` : null,
      searchCounties.length ? `${searchCounties.length} counties` : null,
    ].filter(Boolean).join(" + ");
    const areaSummary = coverageParts
      ? ` · ${coverageParts} queued`
      : searchAreaIncomplete ? " · area lookup incomplete" : "";
    const summary = `${input.request.dateStart}–${input.request.dateEnd} · ${input.request.radiusMiles} miles around ${input.request.anchor.label} · ${input.request.categories.length} event types${areaSummary}`;
    const runId = await this.repository.createRun({
      actorId: input.actorId,
      question: criteria.originalQuestion,
      criteria,
      criteriaSummary: summary,
    });
    try {
      await this.repository.setCriteria(runId, { criteria, criteriaSummary: summary });
      const matches = await this.crmSearch.search(criteria, 10);
      const filteredMatches = input.request.historyFilter === "all"
        ? matches
        : matches.filter((match) => {
            const status = (match.status ?? "").toLowerCase();
            if (input.request.historyFilter === "hide_booked") return status !== "booked";
            return status !== "booked" && status !== "dismissed" && status !== "not_a_fit";
          });
      await this.repository.setCrmReady(runId, filteredMatches);
      const run = await this.repository.getRun({ actorId: input.actorId, runId });
      if (!run) throw new Error("LEAD_SCOUT_RUN_NOT_FOUND");
      return run;
    } catch (error) {
      await this.repository.setFailed(runId, error instanceof Error ? error.message : "Radius Scout discovery failed").catch(() => undefined);
      throw error;
    }
  }
}