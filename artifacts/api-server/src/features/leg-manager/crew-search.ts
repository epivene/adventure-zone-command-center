import type { CrewWorkerWithHistory } from "./crew-types";

export type CrewSearchInput = {
  query?: string | null;
  city?: string | null;
  region?: string | null;
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function rankCrewWorkers(
  workers: CrewWorkerWithHistory[],
  input: CrewSearchInput,
): CrewWorkerWithHistory[] {
  const city = normalized(input.city);
  const region = normalized(input.region);
  const query = normalized(input.query);

  return workers
    .map((worker, index) => {
      const workerCity = normalized(worker.city);
      const workerRegion = normalized(worker.region);
      const text = [
        worker.name,
        worker.phone,
        worker.normalizedPhone,
        worker.email,
        worker.city,
        worker.region,
        worker.locationText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();

      const exactArea = Boolean(city && region && workerCity === city && workerRegion === region);
      const sameRegion = Boolean(region && workerRegion === region);
      const textMatch = Boolean(query && text.includes(query));
      const hasLocationFilter = Boolean(city || region);
      const hasQuery = Boolean(query);

      if (!exactArea && !sameRegion && !textMatch) {
        if (hasLocationFilter || hasQuery) return null;
      }

      const rank = exactArea ? 0 : sameRegion ? 1 : textMatch ? 2 : 3;
      return { worker, rank, index };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.worker);
}
