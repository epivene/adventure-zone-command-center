import { PostgresLeadScoutCrmSearch, type LeadScoutCrmSearch } from "./lead-scout-crm-search";
import { LeadScoutRepository } from "./lead-scout-repository";
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
  anchor: RadiusScoutAnchorInput;
  radiusMiles: RadiusScoutRequest["radiusMiles"];
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: ScoutHistoryFilter;
};

type RadiusCriteria = LeadDiscoveryCriteria & { radiusScope: RadiusScoutScope };

type Repository = Pick<LeadScoutRepository, "createRun" | "setCriteria" | "setCrmReady" | "getRun" | "setFailed">;

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

export class RadiusLeadScoutService {
  constructor(
    private readonly repository: Repository = new LeadScoutRepository(),
    private readonly crmSearch: LeadScoutCrmSearch = new PostgresLeadScoutCrmSearch(),
  ) {}

  async create(input: { actorId: string; request: RadiusScoutRequest }): Promise<LeadScoutRunView> {
    const { city, region } = manualCityRegion(input.request.anchor);
    const scope: RadiusScoutScope = {
      mode: "radius",
      anchor: {
        ...input.request.anchor,
        city: city ?? undefined,
        region: region ?? undefined,
      },
      radiusMiles: input.request.radiusMiles,
      dateStart: input.request.dateStart,
      dateEnd: input.request.dateEnd,
      categories: input.request.categories,
      historyFilter: input.request.historyFilter,
    };
    const criteria: RadiusCriteria = {
      originalQuestion: `Scout ${input.request.radiusMiles} miles around ${input.request.anchor.label}`,
      dateFrom: input.request.dateStart,
      dateThrough: input.request.dateEnd,
      month: null,
      year: Number(input.request.dateStart.slice(0, 4)) || null,
      regions: region ? [region] : [],
      cities: city ? [city] : [],
      geoMode: "radius",
      routeId: null,
      legId: null,
      eventKeywords: categoryKeywords(input.request.categories),
      fitIntent: "either",
      radiusScope: scope,
    };
    const summary = `${input.request.dateStart}–${input.request.dateEnd} · ${input.request.radiusMiles} miles around ${input.request.anchor.label} · ${input.request.categories.length} event types`;
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
