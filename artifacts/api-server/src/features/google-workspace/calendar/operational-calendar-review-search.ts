import { buildProfileSearchTerms, profileSearchScore } from "../../organizations/profile-search";

export type ReviewProfile = { profileId: string; profileName: string; city: string | null; region: string | null };
export function searchCalendarRecords<T>(query: string, records: T[], values: (record: T) => string[]) {
  const terms = buildProfileSearchTerms(query);
  if (!terms.length) return [];
  return records.map((record, index) => ({ record, index, score: profileSearchScore(terms, values(record)) }))
    .filter((item): item is { record: T; index: number; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 50).map(item => item.record);
}

const generic = new Set(["the", "and", "of", "city", "town", "county", "fair", "festival", "event", "annual", "cancelled", "canceled", "zone", "pirates", "warriors", "adventure", "confirmed", "potential", "tentative", "ut", "co", "wy", "mt", "id", "az", "nd", "sd", "or", "wa", "nv"]);
/** Broader read-only discovery, deliberately separate from automatic-link confidence. */
export function suggestCalendarProfiles(input: { eventName?: string | null; summary?: string | null; city?: string | null; region?: string | null; managerToken?: string | null }, profiles: ReviewProfile[]) {
  const managers = new Set(buildProfileSearchTerms(input.managerToken ?? ""));
  const terms = buildProfileSearchTerms([input.eventName, input.summary].filter(Boolean).join(" "))
    .filter(term => !generic.has(term) && !managers.has(term) && !/^\d+$/.test(term));
  const city = buildProfileSearchTerms(input.city ?? "").join(" ");
  const region = (input.region ?? "").trim().toLowerCase();
  return profiles.map(profile => {
    const name = buildProfileSearchTerms(profile.profileName).filter(term => !generic.has(term) && !/^\d+$/.test(term));
    const shared = name.filter(term => terms.includes(term));
    // Do not suggest every fair in a city based solely on its location.
    if (!shared.length || (shared.length === 1 && shared[0].length < 4)) return null;
    const locationConflict = !!region && !!profile.region && region !== profile.region.toLowerCase();
    const score = shared.length * 20 + (shared.length === name.length ? 20 : 0)
      + (city && buildProfileSearchTerms(profile.city ?? "").join(" ") === city ? 15 : 0)
      + (region && profile.region?.toLowerCase() === region ? 10 : 0) - (locationConflict ? 30 : 0);
    return { ...profile, score, matchNote: locationConflict ? "State differs — verify this profile" : "Name clues match — verify booking year and dates" };
  }).filter((p): p is ReviewProfile & { score: number; matchNote: string } => p !== null)
    .sort((a, b) => b.score - a.score || a.profileName.localeCompare(b.profileName)).slice(0, 8);
}
