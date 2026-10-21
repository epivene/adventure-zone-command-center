export type MatchProfile = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
};
export type Confidence = "High" | "Medium" | "Low";
export const normalize = (s?: string | null) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function nameTokens(p: MatchProfile) {
  let name = normalize(p.name);
  // Remove saved location decorations, but never the distinguishing county name.
  for (const location of [p.region, p.city]) {
    const value = normalize(location);
    if (value && name.endsWith(` ${value}`))
      name = name.slice(0, -value.length).trim();
  }
  return [
    ...new Set(
      name
        .split(" ")
        .filter(
          (w) =>
            w &&
            ![
              "the",
              "county",
              "fair",
              "fairgrounds",
              "annual",
              "inc",
              "llc",
              "and",
              "of",
            ].includes(w),
        ),
    ),
  ];
}
const eventKind = (name: string) =>
  /\b(car show|craft|harvest|spring|summer|fall|winter|winterfest|swim|open|youth|january|february|march|april|may|june|july|august|september|october|november|december)\b/i
    .exec(name)?.[1]
    ?.toLowerCase();
function prepare(profile: MatchProfile) {
  const tokens = nameTokens(profile),
    name = tokens.join(" ");
  const bigrams = new Map<string, number>();
  for (let i = 0; i < name.length - 1; i++) {
    const part = name.slice(i, i + 2);
    bigrams.set(part, (bigrams.get(part) ?? 0) + 1);
  }
  return {
    profile,
    tokens,
    name,
    bigrams,
    aliases: profile.name
      .split(/\s[---]\s/)
      .map((name) => nameTokens({ ...profile, name }).join(" "))
      .filter(Boolean),
    city: normalize(profile.city),
    region: normalize(profile.region),
    year: profile.name.match(/\b(?:19|20)\d{2}\b/)?.[0],
    kind: eventKind(profile.name),
  };
}
type PreparedProfile = ReturnType<typeof prepare>;
function dice(a: PreparedProfile, b: PreparedProfile) {
  if (a.name === b.name) return 1;
  if (a.name.length < 3 || b.name.length < 3) return 0;
  let common = 0;
  for (const [part, count] of a.bigrams)
    common += Math.min(count, b.bigrams.get(part) ?? 0);
  return (2 * common) / (a.name.length + b.name.length - 2);
}
export function scorePair(left: MatchProfile, right: MatchProfile) {
  return scorePrepared(prepare(left), prepare(right));
}
function scorePrepared(
  preparedLeft: PreparedProfile,
  preparedRight: PreparedProfile,
) {
  const left = preparedLeft.profile,
    right = preparedRight.profile;
  const a = preparedLeft.tokens,
    b = preparedRight.tokens;
  if (!a.length || !b.length) return null;
  const common = a.filter((w) => b.includes(w)).length;
  const overlap = common / Math.min(a.length, b.length);
  const exact = a.join(" ") === b.join(" ");
  const aliasMatch = preparedLeft.aliases.some((alias) =>
    preparedRight.aliases.includes(alias),
  );
  // Containment catches a distinctive subtitle, e.g. Wyoming's Big Show.
  const similarity = Math.max(
    aliasMatch ? 0.94 : 0,
    common / Math.max(a.length, b.length),
    overlap === 1 &&
      (common >= 3 ||
        (common >= 2 &&
          [...a, ...b]
            .filter((w) => !a.includes(w) || !b.includes(w))
            .every((w) => w === "rodeo")))
      ? 0.94
      : 0,
    dice(preparedLeft, preparedRight) * 0.92,
  );
  if (!exact && similarity < 0.64) return null;
  const city = preparedLeft.city,
    otherCity = preparedRight.city;
  const region = preparedLeft.region,
    otherRegion = preparedRight.region;
  const cityMatch = !!city && city === otherCity,
    regionMatch = !!region && region === otherRegion;
  const yearConflict =
    !!preparedLeft.year &&
    !!preparedRight.year &&
    preparedLeft.year !== preparedRight.year;
  const kindConflict =
    preparedLeft.kind !== preparedRight.kind &&
    !!(preparedLeft.kind || preparedRight.kind);
  const conflict =
    (!!city && !!otherCity && !cityMatch) ||
    (!!region && !!otherRegion && !regionMatch);
  let score = Math.round(
    similarity * 75 + (cityMatch ? 15 : 0) + (regionMatch ? 10 : 0),
  );
  if (conflict || yearConflict || kindConflict)
    score = Math.min(59, score - 15);
  if (score < 48) return null;
  const confidence: Confidence =
    score >= 88 ? "High" : score >= 68 ? "Medium" : "Low";
  return {
    left,
    right,
    score,
    confidence,
    reasons: [
      exact ? "Same normalized name" : "Similar name or distinctive subtitle",
      ...(cityMatch ? ["Same city"] : []),
      ...(regionMatch ? ["Same state/region"] : []),
      ...(conflict ? ["Location differs: verify identity"] : []),
      ...(yearConflict ? ["Different event years: verify identity"] : []),
      ...(kindConflict
        ? ["Different event or season wording: verify identity"]
        : []),
      ...(!city || !otherCity ? ["City information incomplete"] : []),
    ],
  };
}
type Pair = NonNullable<ReturnType<typeof scorePair>>;
const sortPairs = (pairs: Pair[]) =>
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.left.id.localeCompare(b.left.id) ||
      a.right.id.localeCompare(b.right.id),
  );
const prepareAll = (profiles: MatchProfile[]) =>
  [...profiles].sort((a, b) => a.id.localeCompare(b.id)).map(prepare);

export function findPairs(
  profiles: MatchProfile[],
  dismissed = new Set<string>(),
) {
  const sorted = prepareAll(profiles),
    pairs: Pair[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      if (dismissed.has(sorted[i].profile.id + ":" + sorted[j].profile.id))
        continue;
      const pair = scorePrepared(sorted[i], sorted[j]);
      if (pair) pairs.push(pair);
    }
  return sortPairs(pairs);
}

// The API must keep serving health checks and other requests during a full scan.
// Prepare each name once, preserve exhaustive comparisons, and yield in time slices.
export async function findPairsAsync(
  profiles: MatchProfile[],
  dismissed = new Set<string>(),
) {
  const sorted = prepareAll(profiles),
    pairs: Pair[] = [];
  let comparisons = 0,
    lastYield = Date.now();
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      if ((++comparisons & 127) === 0 && Date.now() - lastYield >= 8) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        lastYield = Date.now();
      }
      if (dismissed.has(sorted[i].profile.id + ":" + sorted[j].profile.id))
        continue;
      const pair = scorePrepared(sorted[i], sorted[j]);
      if (pair) pairs.push(pair);
    }
  return sortPairs(pairs);
}
