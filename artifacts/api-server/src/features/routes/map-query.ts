import {
  filterMapEvents,
  type MapEvent,
  type MapFilters,
} from "@/features/routes/map-data";
import type { TravelLegRepository } from "@/features/routes/travel-leg-repository";

export {
  filterMapEvents,
  toMapDataset,
  type MapDataset,
  type MapEvent,
  type MapFeature,
  type MapFeatureCollection,
  type MapFeatureProperties,
  type MapFilters,
} from "@/features/routes/map-data";

export async function getMapEvents(
  filters: MapFilters,
  repository?: TravelLegRepository,
): Promise<MapEvent[]> {
  let resolvedRepository = repository;
  if (!resolvedRepository) {
    const [{ db }, { DrizzleTravelLegRepository }] = await Promise.all([
      import("@/db/client"),
      import("@/features/routes/travel-leg-repository"),
    ]);
    resolvedRepository = new DrizzleTravelLegRepository(db);
  }

  return filterMapEvents(await resolvedRepository.listMapEvents(), filters);
}
