import {
  normalizeMatchingEmail,
  normalizeMatchingText,
  normalizeWebsiteHost,
} from "@/features/act-migration/matching-normalization";

type ContextIndexName =
  | "organizationName"
  | "contactName"
  | "bookingName"
  | "directContact"
  | "websiteHost"
  | "location"
  | "eventDate"
  | "eventLocation";

export type ContextIndexRow = {
  sourceRecordId: string;
  streamType: string;
  rawSnapshot: Record<string, unknown>;
};

export type ContextIndexLocalCandidates = {
  organizations?: readonly { id: string; name: string; phone?: string | null; website?: string | null; city?: string | null; region?: string | null }[];
  contacts?: readonly { id: string; firstName: string; lastName: string; email?: string | null; phone?: string | null; city?: string | null; region?: string | null }[];
  bookings?: readonly { id: string; name: string; startsAt?: string | null; city?: string | null; region?: string | null }[];
};

export type NarrativeContextMention = {
  family: "narrative_context";
  label: string;
  sourceRecordId: string;
  streamType: string;
};

type NarrativeNameCandidate = {
  phrase: string;
  sourceRecordId: string;
  streamType: string;
  kind: string;
};

type NarrativeNameTrieNode = {
  candidates: NarrativeNameCandidate[];
  children: Map<string, NarrativeNameTrieNode>;
};

const stopPhrases = new Set(["the", "and", "for", "unknown", "none", "n a"]);

function value(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function addressValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
  const direct = value(record, keys);
  if (direct) return direct;
  for (const addressKey of ["businessAddress", "BusinessAddress", "address", "Address"]) {
    const address = record[addressKey];
    if (!address || typeof address !== "object" || Array.isArray(address)) continue;
    const nested = value(address as Record<string, unknown>, keys);
    if (nested) return nested;
  }
  return null;
}

function phone(valueToNormalize: string | null | undefined): string | null {
  const digits = (valueToNormalize ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function date(valueToNormalize: string | null | undefined): string | null {
  return /^(\d{4}-\d{2}-\d{2})/.exec(valueToNormalize?.trim() ?? "")?.[1] ?? null;
}

function location(city: string | null | undefined, region: string | null | undefined): string | null {
  const normalizedCity = normalizeMatchingText(city ?? null);
  const normalizedRegion = normalizeMatchingText(region ?? null);
  return normalizedCity && normalizedRegion ? `${normalizedCity}|${normalizedRegion}` : null;
}

function phrase(valueToNormalize: string | null | undefined): string | null {
  const normalized = normalizeMatchingText(valueToNormalize ?? null);
  if (!normalized || normalized.length < 4 || stopPhrases.has(normalized)) return null;
  return normalized;
}

function finalize(index: Map<string, Set<string>>): Map<string, readonly string[]> {
  return new Map([...index.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, ids]) => [key, [...ids].sort()]));
}

function narrativeTokens(normalizedText: string): string[] {
  return normalizedText.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function narrativeNameTrie(candidates: readonly NarrativeNameCandidate[]): NarrativeNameTrieNode {
  const root: NarrativeNameTrieNode = { candidates: [], children: new Map() };
  for (const candidate of candidates) {
    let node = root;
    for (const token of narrativeTokens(candidate.phrase)) {
      let child = node.children.get(token);
      if (!child) {
        child = { candidates: [], children: new Map() };
        node.children.set(token, child);
      }
      node = child;
    }
    node.candidates.push(candidate);
  }
  return root;
}

function narrativeCandidatesInText(
  normalizedText: string,
  root: NarrativeNameTrieNode,
): NarrativeNameCandidate[] {
  const tokens = narrativeTokens(normalizedText);
  const matches: NarrativeNameCandidate[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    let node: NarrativeNameTrieNode | undefined = root;
    for (let position = start; position < tokens.length; position += 1) {
      node = node.children.get(tokens[position]!);
      if (!node) break;
      matches.push(...node.candidates);
    }
  }
  return matches;
}

export function buildActContextIndex(
  rows: readonly ContextIndexRow[],
  localCandidates: ContextIndexLocalCandidates,
) {
  const mutable = Object.fromEntries([
    "organizationName", "contactName", "bookingName", "directContact",
    "websiteHost", "location", "eventDate", "eventLocation",
  ].map((key) => [key, new Map<string, Set<string>>()])) as Record<ContextIndexName, Map<string, Set<string>>>;
  const sourceTypes = new Map<string, string>();
  const narrativeNames: NarrativeNameCandidate[] = [];
  const add = (name: ContextIndexName, key: string | null, id: string) => {
    if (!key) return;
    const ids = mutable[name].get(key) ?? new Set<string>();
    ids.add(id);
    mutable[name].set(key, ids);
  };
  const addName = (name: ContextIndexName, rawName: string | null, id: string, streamType: string, kind: string) => {
    const normalized = phrase(rawName);
    add(name, normalized, id);
    if (normalized) narrativeNames.push({ phrase: normalized, sourceRecordId: id, streamType, kind });
  };

  for (const row of rows) {
    const raw = row.rawSnapshot;
    sourceTypes.set(row.sourceRecordId, row.streamType);
    if (row.streamType === "company") {
      addName("organizationName", value(raw, ["name", "Name"]), row.sourceRecordId, row.streamType, "company");
      add("directContact", phone(value(raw, ["businessPhone", "BusinessPhone", "phone", "Phone"])), row.sourceRecordId);
      add("websiteHost", normalizeWebsiteHost(value(raw, ["website", "Website"])), row.sourceRecordId);
      add("location", location(addressValue(raw, ["city", "City"]), addressValue(raw, ["region", "Region", "state", "State"])), row.sourceRecordId);
    } else if (row.streamType === "contact") {
      const fullName = [value(raw, ["firstName", "FirstName"]), value(raw, ["lastName", "LastName"])].filter(Boolean).join(" ");
      addName("contactName", fullName, row.sourceRecordId, row.streamType, "contact");
      add("directContact", normalizeMatchingEmail(value(raw, ["emailAddress", "EmailAddress", "email", "Email"])), row.sourceRecordId);
      add("directContact", phone(value(raw, ["businessPhone", "BusinessPhone", "phone", "Phone"])), row.sourceRecordId);
      add("location", location(addressValue(raw, ["city", "City"]), addressValue(raw, ["region", "Region", "state", "State"])), row.sourceRecordId);
    } else if (row.streamType === "opportunity") {
      addName("bookingName", value(raw, ["name", "Name"]), row.sourceRecordId, row.streamType, "booking");
      add("eventDate", date(value(raw, ["startsAt", "StartsAt", "startDate", "StartDate", "estimatedCloseDate", "EstimatedCloseDate"])), row.sourceRecordId);
      add("eventLocation", location(addressValue(raw, ["city", "City"]), addressValue(raw, ["region", "Region", "state", "State"])), row.sourceRecordId);
    }
  }

  for (const candidate of localCandidates.organizations ?? []) {
    add("organizationName", phrase(candidate.name), candidate.id);
    add("directContact", phone(candidate.phone), candidate.id);
    add("websiteHost", normalizeWebsiteHost(candidate.website ?? null), candidate.id);
    add("location", location(candidate.city, candidate.region), candidate.id);
  }
  for (const candidate of localCandidates.contacts ?? []) {
    add("contactName", phrase(`${candidate.firstName} ${candidate.lastName}`), candidate.id);
    add("directContact", normalizeMatchingEmail(candidate.email ?? null), candidate.id);
    add("directContact", phone(candidate.phone), candidate.id);
    add("location", location(candidate.city, candidate.region), candidate.id);
  }
  for (const candidate of localCandidates.bookings ?? []) {
    add("bookingName", phrase(candidate.name), candidate.id);
    add("eventDate", date(candidate.startsAt), candidate.id);
    add("eventLocation", location(candidate.city, candidate.region), candidate.id);
  }

  const indexes = Object.fromEntries(Object.entries(mutable).map(([key, map]) => [key, finalize(map)])) as Record<ContextIndexName, Map<string, readonly string[]>>;
  const narrativeNameCounts = new Map<string, number>();
  for (const candidate of narrativeNames) {
    const key = `${candidate.kind}\u0000${candidate.phrase}`;
    narrativeNameCounts.set(key, (narrativeNameCounts.get(key) ?? 0) + 1);
  }
  const uniqueNarrativeNames = narrativeNames.filter((candidate) =>
    narrativeNameCounts.get(`${candidate.kind}\u0000${candidate.phrase}`) === 1,
  );
  const uniqueNarrativeNameTrie = narrativeNameTrie(uniqueNarrativeNames);
  return {
    ...indexes,
    unique(name: ContextIndexName, key: string): string | null {
      const ids = indexes[name].get(key);
      return ids?.length === 1 ? ids[0]! : null;
    },
    narrativeMentions(fields: { subject?: string | null; regarding?: string | null; details?: string | null; body?: string | null }): NarrativeContextMention[] {
      const mentions: NarrativeContextMention[] = [];
      for (const [field, rawText] of Object.entries(fields)) {
        const normalizedText = normalizeMatchingText(rawText ?? null);
        if (!normalizedText) continue;
        const candidates = new Set(narrativeCandidatesInText(normalizedText, uniqueNarrativeNameTrie));
        for (const candidate of candidates) {
          mentions.push({
            family: "narrative_context",
            label: `${field} mentions ${candidate.kind} name`,
            sourceRecordId: candidate.sourceRecordId,
            streamType: sourceTypes.get(candidate.sourceRecordId) ?? candidate.streamType,
          });
        }
      }
      return mentions.sort((left, right) => left.label.localeCompare(right.label) || left.sourceRecordId.localeCompare(right.sourceRecordId));
    },
  };
}
