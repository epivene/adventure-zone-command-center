export function importedTravelLegPatch(
  travelLegId: unknown,
): { travelLegId?: string } {
  if (typeof travelLegId !== "string") return {};
  const normalized = travelLegId.trim();
  return normalized ? { travelLegId: normalized } : {};
}
