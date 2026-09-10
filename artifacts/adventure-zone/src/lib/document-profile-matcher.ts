export type ProfileMatchDocument = {
  displayName: string;
  originalFilename: string;
  category: string;
  links: Array<{ targetKind: string }>;
  reviewState?: string;
};

export type ProfileMatchOption = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

export type StrongProfileMatch = {
  profile: ProfileMatchOption;
  confidence: number;
  reason: string;
};

const EVENT_DOCUMENT_CATEGORIES = new Set([
  "contract",
  "proposal",
  "coi",
  "permit",
  "vendor_application",
  "inspection",
  "deposit_receipt",
]);

const DOCUMENT_NOISE = /\b(?:certificate\s+of\s+insurance|vendor\s+application|deposit\s+receipt|adventure\s+zone|contract|agreement|proposal|quote|coi|permit|inspection|application|packet|form|signed|signature|revised|revision|updated|final|draft|copy|both|adventure)\b/gi;
const PROFILE_CATEGORY_PREFIX = /^county\s+fair\s*[-:]\s*/i;

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(haystack: string, needle: string) {
  return ` ${haystack} `.includes(` ${needle} `);
}

export function isProfileLinkCandidate(document: ProfileMatchDocument) {
  return EVENT_DOCUMENT_CATEGORIES.has(document.category)
    && document.reviewState !== "rejected"
    && !document.links.some((link) => link.targetKind === "profile");
}

export function buildProfileSearchQuery(document: Pick<ProfileMatchDocument, "displayName" | "originalFilename">) {
  const source = document.displayName.trim() || document.originalFilename;
  return source
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[\-_]+/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(DOCUMENT_NOISE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:()\[\]-]+|[\s,;:()\[\]-]+$/g, "")
    .trim();
}

function scoreProfile(document: ProfileMatchDocument, profile: ProfileMatchOption) {
  const query = normalize(buildProfileSearchQuery(document));
  const hasCountyFairPrefix = PROFILE_CATEGORY_PREFIX.test(profile.name);
  const profileName = normalize(profile.name.replace(PROFILE_CATEGORY_PREFIX, ""));
  const comparableQuery = hasCountyFairPrefix ? normalize(query.replace(/\bcounty\s+fair\b/g, " ")) : query;
  const nameTokens = profileName.split(" ").filter(Boolean);
  if (!query || !profileName || (nameTokens.length < 2 && profileName.length < 7)) return null;

  const documentText = normalize(`${document.displayName} ${document.originalFilename}`);
  const comparableDocumentText = hasCountyFairPrefix
    ? normalize(documentText.replace(/\bcounty\s+fair\b/g, " "))
    : documentText;
  const exactQuery = comparableQuery === profileName;
  const fullNamePresent = containsPhrase(comparableQuery, profileName) || containsPhrase(comparableDocumentText, profileName);
  if (!exactQuery && !fullNamePresent) return null;

  let confidence = exactQuery ? 0.98 : 0.97;
  const cityMatches = Boolean(profile.city && containsPhrase(documentText, normalize(profile.city)));
  const regionMatches = Boolean(profile.region && containsPhrase(documentText, normalize(profile.region)));
  if (cityMatches) confidence += 0.01;
  if (regionMatches) confidence += 0.01;

  return {
    profile,
    confidence: Math.min(0.99, Number(confidence.toFixed(2))),
    reason: cityMatches || regionMatches
      ? "Profile name and location match the document name"
      : "Profile name exactly matches the document name",
  } satisfies StrongProfileMatch;
}

export function chooseStrongProfileMatch(
  document: ProfileMatchDocument,
  profiles: ProfileMatchOption[],
): StrongProfileMatch | null {
  const ranked = profiles
    .map((profile) => scoreProfile(document, profile))
    .filter((match): match is StrongProfileMatch => match !== null)
    .sort((left, right) => right.confidence - left.confidence);
  const best = ranked[0];
  if (!best || best.confidence < 0.97) return null;
  if (ranked[1] && best.confidence - ranked[1].confidence < 0.03) return null;
  return best;
}
