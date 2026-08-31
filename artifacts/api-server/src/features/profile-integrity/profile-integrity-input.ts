const PROFILE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readProfileIntegrityId(
  value: string | string[] | undefined,
): string | null {
  const profileId = Array.isArray(value) ? value[0] : value;
  return profileId && PROFILE_UUID_PATTERN.test(profileId) ? profileId : null;
}
