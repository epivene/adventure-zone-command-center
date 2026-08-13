import {
  normalizeMatchingText,
  normalizeWebsiteHost,
} from "@/features/act-migration/matching-normalization";

export type FamilyCandidateEvidence = {
  family: "name" | "website" | "location" | "act_relationship";
  label: string;
};

export type OrganizationFamilyRecord = {
  id: string;
  name: string;
  website?: string | null;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  actRelationshipIds?: readonly string[];
};

export type OrganizationFamilyClassification =
  | {
      kind: "location_family";
      groupKey: string;
      candidateIds: string[];
      evidence: FamilyCandidateEvidence[];
    }
  | { kind: "insufficient" };

function normalizedBaseName(name: string): string | null {
  const withoutLocationSuffix = name
    .trim()
    .replace(/\s+-\s+[^,()\r\n]+,\s*[a-z]{2}$/i, "")
    .replace(/\s+\([^()\r\n]+\)\s+[a-z]{2}$/i, "");

  return normalizeMatchingText(withoutLocationSuffix);
}

function normalizedLocation(
  record: OrganizationFamilyRecord,
): string | null {
  const city = normalizeMatchingText(record.city ?? null);
  const region = normalizeMatchingText(record.region ?? null);
  return city && region ? `${city}\u0000${region}` : null;
}

function normalizedAddress(
  record: OrganizationFamilyRecord,
): string | null {
  const address1 = normalizeMatchingText(record.address1 ?? null);
  const postalCode = normalizeMatchingText(record.postalCode ?? null);
  return address1 && postalCode ? `${address1}\u0000${postalCode}` : null;
}

function relationshipsConnect(
  records: readonly OrganizationFamilyRecord[],
): boolean {
  const candidateIds = new Set(records.map((record) => record.id));
  const adjacent = new Map<string, Set<string>>(
    records.map((record) => [record.id, new Set<string>()]),
  );

  for (const record of records) {
    for (const relatedId of record.actRelationshipIds ?? []) {
      if (!candidateIds.has(relatedId) || relatedId === record.id) continue;
      adjacent.get(record.id)?.add(relatedId);
      adjacent.get(relatedId)?.add(record.id);
    }
  }

  const firstId = records[0]?.id;
  if (!firstId) return false;
  const visited = new Set<string>([firstId]);
  const pending = [firstId];
  while (pending.length) {
    const current = pending.pop()!;
    for (const relatedId of adjacent.get(current) ?? []) {
      if (visited.has(relatedId)) continue;
      visited.add(relatedId);
      pending.push(relatedId);
    }
  }

  return visited.size === records.length;
}

function allValuesAgree(values: readonly (string | null)[]): boolean {
  return values.every((value) => value !== null) && new Set(values).size === 1;
}

export function classifyOrganizationFamily(
  records: readonly OrganizationFamilyRecord[],
): OrganizationFamilyClassification {
  if (records.length < 2) return { kind: "insufficient" };

  const candidateIds = records
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right, "en-US"));
  if (
    candidateIds.some((candidateId) => !candidateId) ||
    new Set(candidateIds).size !== records.length
  ) {
    return { kind: "insufficient" };
  }

  const locations = records.map(normalizedLocation);
  if (
    locations.some((location) => location === null) ||
    new Set(locations).size !== records.length
  ) {
    return { kind: "insufficient" };
  }

  const addresses = records.map(normalizedAddress).filter(
    (address): address is string => address !== null,
  );
  if (new Set(addresses).size !== addresses.length) {
    return { kind: "insufficient" };
  }

  const websites = records.map((record) =>
    normalizeWebsiteHost(record.website ?? null),
  );
  if (!allValuesAgree(websites)) return { kind: "insufficient" };

  const namesAgree = allValuesAgree(
    records.map((record) => normalizedBaseName(record.name)),
  );
  const actRelationshipsConnect = relationshipsConnect(records);
  if (!namesAgree && !actRelationshipsConnect) {
    return { kind: "insufficient" };
  }

  const evidence: FamilyCandidateEvidence[] = [];
  if (namesAgree) {
    evidence.push({
      family: "name",
      label: "normalized base names agree",
    });
  }
  evidence.push(
    { family: "website", label: "website domains agree" },
    { family: "location", label: "locations differ" },
  );
  if (actRelationshipsConnect) {
    evidence.push({
      family: "act_relationship",
      label: "ACT organization relationships connect the records",
    });
  }

  return {
    kind: "location_family",
    groupKey: `organization-family:${candidateIds.join("|")}`,
    candidateIds,
    evidence,
  };
}
