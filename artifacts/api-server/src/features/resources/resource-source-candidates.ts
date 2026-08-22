export const SOURCE_ASSETS = [
  { name: "Labyrinth Maze", yearBuilt: 2019, make: "Inflatable", model: "Maze", serialNumber: "001" },
  { name: "Choo Choo Playhouse", yearBuilt: 2018, make: "Inflatable", model: "Train", serialNumber: "002" },
  { name: "Slide From The Castle", yearBuilt: 2018, make: "Inflatable", model: "3 In 1 Combo", serialNumber: "003" },
  { name: "Beautiful Balloon", yearBuilt: 2020, make: "Inflatable", model: "Combo", serialNumber: "004" },
  { name: "Arctic Blast", yearBuilt: 2020, make: "Inflatable", model: "Slide", serialNumber: "005" },
  { name: "Run For The Hills", yearBuilt: 2018, make: "Inflatable", model: "Obstacle Course", serialNumber: "006" },
  { name: "Purple House", yearBuilt: 2019, make: "Inflatable", model: "Combo", serialNumber: "007" },
  { name: "Eliminator", yearBuilt: 2019, make: "Inflatable", model: "Interactive Amusement", serialNumber: "008" },
  { name: "Take Me Out To The Ballgame", yearBuilt: 2018, make: "Inflatable", model: "Slide", serialNumber: "009" },
] as const;

export type SourceAsset = (typeof SOURCE_ASSETS)[number];

export function normalizeAssetName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyExactAssetMatch(
  sourceName: string,
  resources: Array<{ id: string; name: string; status: string }>,
): { state: "exact_match" | "pending"; resourceId: string | null } {
  const normalized = normalizeAssetName(sourceName);
  const matches = resources.filter(
    (resource) =>
      resource.status !== "archived" && normalizeAssetName(resource.name) === normalized,
  );
  return matches.length === 1
    ? { state: "exact_match", resourceId: matches[0]!.id }
    : { state: "pending", resourceId: null };
}

type ExistingIdentity = {
  yearBuilt: number | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
};

export function canApplySourceIdentity(
  existing: ExistingIdentity,
  source: Pick<SourceAsset, "yearBuilt" | "make" | "model" | "serialNumber">,
): { allowed: boolean; conflicts: Array<keyof ExistingIdentity> } {
  const conflicts: Array<keyof ExistingIdentity> = [];
  for (const key of ["yearBuilt", "make", "model", "serialNumber"] as const) {
    const current = existing[key];
    const incoming = source[key];
    if (current !== null && current !== incoming) conflicts.push(key);
  }
  return { allowed: conflicts.length === 0, conflicts };
}
