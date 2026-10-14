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
    .replace(/[’']/g, "")
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
function dice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  const parts = (s: string) =>
    Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  const remaining = parts(b);
  let common = 0;
  for (const p of parts(a)) {
    const i = remaining.indexOf(p);
    if (i >= 0) {
      common++;
      remaining.splice(i, 1);
    }
  }
  return (2 * common) / (a.length + b.length - 2);
}
export function scorePair(left: MatchProfile, right: MatchProfile) {
  const a = nameTokens(left),
    b = nameTokens(right);
  if (!a.length || !b.length) return null;
  const common = a.filter((w) => b.includes(w)).length;
  const overlap = common / Math.min(a.length, b.length);
  const exact = a.join(" ") === b.join(" ");
  const aliases = (p: MatchProfile) =>
    p.name
      .split(/\s[-–—]\s/)
      .map((name) => nameTokens({ ...p, name }).join(" "))
      .filter(Boolean);
  const aliasMatch = aliases(left).some((alias) =>
    aliases(right).includes(alias),
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
    dice(a.join(" "), b.join(" ")) * 0.92,
  );
  if (!exact && similarity < 0.64) return null;
  const city = normalize(left.city),
    otherCity = normalize(right.city);
  const region = normalize(left.region),
    otherRegion = normalize(right.region);
  const cityMatch = !!city && city === otherCity,
    regionMatch = !!region && region === otherRegion;
  const year = (name: string) => name.match(/\b(?:19|20)\d{2}\b/)?.[0];
  const yearConflict =
    !!year(left.name) &&
    !!year(right.name) &&
    year(left.name) !== year(right.name);
  const eventKind = (name: string) =>
    /\b(car show|craft|harvest|spring|summer|fall|winter|winterfest|swim|open|youth|january|february|march|april|may|june|july|august|september|october|november|december)\b/i
      .exec(name)?.[1]
      ?.toLowerCase();
  const kindConflict =
    eventKind(left.name) !== eventKind(right.name) &&
    !!(eventKind(left.name) || eventKind(right.name));
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
export function findPairs(
  profiles: MatchProfile[],
  dismissed = new Set<string>(),
) {
  const pairs: NonNullable<ReturnType<typeof scorePair>>[] = [];
  const sorted = [...profiles].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      if (dismissed.has(`${sorted[i].id}:${sorted[j].id}`)) continue;
      const pair = scorePair(sorted[i], sorted[j]);
      if (pair) pairs.push(pair);
    }
  return pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.left.id.localeCompare(b.left.id) ||
      a.right.id.localeCompare(b.right.id),
  );
}
