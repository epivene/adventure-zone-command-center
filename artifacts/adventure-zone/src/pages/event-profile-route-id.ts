export function resolveEventProfileRouteId(
  explicitProfileId: string | undefined,
  params: { profileId?: string; id?: string },
) {
  return explicitProfileId ?? params.profileId ?? params.id ?? "";
}
