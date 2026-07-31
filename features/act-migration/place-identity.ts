export type PlaceIdentityInput = {
  name: string;
  location: string | null;
};

export type PlaceIdentityRow = PlaceIdentityInput & {
  sourceId: string;
};

function normalizeIdentityPart(value: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Returns a comparison-only identity. Display values remain on the staged
 * source records and are never changed by this normalization.
 */
export function normalizePlaceIdentity(
  input: PlaceIdentityInput,
): { name: string; location: string } {
  return {
    name: normalizeIdentityPart(input.name),
    location: normalizeIdentityPart(input.location),
  };
}

export function placeIdentityGroupKey(input: PlaceIdentityInput) {
  const identity = normalizePlaceIdentity(input);
  return JSON.stringify([identity.name, identity.location]);
}

/** Groups rows deterministically without mutating their original display data. */
export function groupExactPlaceDuplicates<T extends PlaceIdentityRow>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of [...rows].toSorted((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  )) {
    const key = placeIdentityGroupKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return new Map([...grouped.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  ));
}
