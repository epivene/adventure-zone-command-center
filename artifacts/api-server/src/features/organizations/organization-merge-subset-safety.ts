type ProfileLocationIdentity = {
  id: string;
  city: string | null;
  region: string | null;
};

function normalize(value: string | null) {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return normalized || null;
}

export function selectedProfilesHaveConflictingCompleteLocations(
  profiles: readonly ProfileLocationIdentity[],
): boolean {
  const completeLocations = profiles.flatMap((profile) => {
    const city = normalize(profile.city);
    const region = normalize(profile.region);
    return city && region ? [`${city}\u0000${region}`] : [];
  });

  return new Set(completeLocations).size > 1;
}

export function shouldBlockSelectedProfileMergeForLocation(
  profiles: readonly ProfileLocationIdentity[],
  reviewedLocationConflict: boolean,
): boolean {
  return !reviewedLocationConflict
    && selectedProfilesHaveConflictingCompleteLocations(profiles);
}
