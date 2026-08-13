import {
  normalizeMatchingText,
  normalizeWebsiteHost,
} from "../act-migration/matching-normalization";
import {
  classifyOrganizationFamily,
  type FamilyCandidateEvidence,
  type OrganizationFamilyRecord,
} from "./organization-family-matcher";

export type OrganizationFamilyCandidateGroup = {
  normalizedName: string;
  city: string;
  region: string;
  classification: "duplicate" | "location_candidate" | "ambiguous_location_candidate";
  groupKey: string | null;
  candidateIds: string[];
  evidence: FamilyCandidateEvidence[];
};

export type OrganizationFamilyActRelationship = {
  sourceOrganizationId: string;
  targetOrganizationId: string;
  provenance: "act_relationship";
};

export function discoverOrganizationFamilyCandidates(
  records: readonly OrganizationFamilyRecord[],
  actRelationships: readonly OrganizationFamilyActRelationship[] = [],
): OrganizationFamilyCandidateGroup[] {
  const relatedIds = new Map<string, Set<string>>(
    records.map((record) => [
      record.id,
      new Set(record.actRelationshipIds ?? []),
    ]),
  );
  for (const relationship of actRelationships) {
    if (
      !relatedIds.has(relationship.sourceOrganizationId) ||
      !relatedIds.has(relationship.targetOrganizationId)
    ) {
      continue;
    }
    relatedIds
      .get(relationship.sourceOrganizationId)
      ?.add(relationship.targetOrganizationId);
    relatedIds
      .get(relationship.targetOrganizationId)
      ?.add(relationship.sourceOrganizationId);
  }
  const hydratedRecords = records.map((record) => ({
    ...record,
    actRelationshipIds: [...(relatedIds.get(record.id) ?? [])].sort(),
  }));

  const byWebsite = new Map<string, OrganizationFamilyRecord[]>();
  for (const record of hydratedRecords) {
    const website = normalizeWebsiteHost(record.website ?? null);
    if (!website) continue;
    const bucket = byWebsite.get(website) ?? [];
    bucket.push(record);
    byWebsite.set(website, bucket);
  }

  const candidates: OrganizationFamilyCandidateGroup[] = [];
  for (const bucket of byWebsite.values()) {
    const adjacent = new Map(
      bucket.map((record) => [record.id, new Set<string>()]),
    );
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex]!;
        const right = bucket[rightIndex]!;
        if (classifyOrganizationFamily([left, right]).kind !== "location_family") continue;
        adjacent.get(left.id)?.add(right.id);
        adjacent.get(right.id)?.add(left.id);
      }
    }

    const recordById = new Map(bucket.map((record) => [record.id, record]));
    const visited = new Set<string>();
    for (const record of bucket) {
      if (visited.has(record.id)) continue;
      const componentIds: string[] = [];
      const pending = [record.id];
      visited.add(record.id);
      while (pending.length) {
        const id = pending.pop()!;
        componentIds.push(id);
        for (const relatedId of adjacent.get(id) ?? []) {
          if (visited.has(relatedId)) continue;
          visited.add(relatedId);
          pending.push(relatedId);
        }
      }
      if (componentIds.length < 2) continue;
      const component = componentIds.map((id) => recordById.get(id)!);
      const classification = classifyOrganizationFamily(component);
      if (classification.kind !== "location_family") continue;
      const first = component.toSorted((left, right) => left.id.localeCompare(right.id))[0]!;
      candidates.push({
        normalizedName: first.name.trim().toLocaleLowerCase("en-US"),
        city: "",
        region: "",
        classification: "location_candidate",
        groupKey: classification.groupKey,
        candidateIds: classification.candidateIds,
        evidence: classification.evidence,
      });
    }
  }

  const strongCandidateSets = new Set(
    candidates.map((candidate) => candidate.candidateIds.join("|")),
  );
  const byExactName = new Map<string, OrganizationFamilyRecord[]>();
  for (const record of hydratedRecords) {
    const exactName = normalizeMatchingText(record.name);
    if (!exactName) continue;
    const bucket = byExactName.get(exactName) ?? [];
    bucket.push(record);
    byExactName.set(exactName, bucket);
  }
  for (const [exactName, bucket] of byExactName) {
    if (bucket.length < 2) continue;
    const candidateIds = bucket
      .map((record) => record.id)
      .sort((left, right) => left.localeCompare(right, "en-US"));
    if (strongCandidateSets.has(candidateIds.join("|"))) continue;

    const locations = bucket.map((record) => {
      const city = normalizeMatchingText(record.city ?? null);
      const region = normalizeMatchingText(record.region ?? null);
      return city && region ? `${city}\u0000${region}` : null;
    });
    if (
      locations.some((location) => location === null) ||
      new Set(locations).size !== bucket.length
    ) {
      continue;
    }
    const addresses = bucket
      .map((record) => normalizeMatchingText(record.address1 ?? null))
      .filter((address): address is string => address !== null);
    if (new Set(addresses).size !== addresses.length) continue;

    candidates.push({
      normalizedName: exactName,
      city: "",
      region: "",
      classification: "ambiguous_location_candidate",
      groupKey: `organization-family:${candidateIds.join("|")}`,
      candidateIds,
      evidence: [
        { family: "name", label: "exact organization names agree" },
        { family: "location", label: "locations differ" },
      ],
    });
  }

  return candidates.toSorted((left, right) =>
    (left.groupKey ?? "").localeCompare(right.groupKey ?? "", "en-US"),
  );
}

export function partitionOrganizationReviewGroups(
  duplicateRows: readonly {
    normalized_name: string;
    normalized_city: string;
    normalized_region: string;
    ids: string[];
  }[],
  discoveredFamilies: readonly OrganizationFamilyCandidateGroup[],
  reviews: readonly { groupKey: string; status: "proposed" | "not_related" }[],
): OrganizationFamilyCandidateGroup[] {
  const reviewByKey = new Map(reviews.map((review) => [review.groupKey, review]));
  const visibleFamilies = discoveredFamilies.filter(
    (group) =>
      group.groupKey && reviewByKey.get(group.groupKey)?.status !== "not_related",
  );
  const allFamilyCandidateIds = new Set(
    discoveredFamilies.flatMap((group) => group.candidateIds),
  );
  const duplicateGroups: OrganizationFamilyCandidateGroup[] = duplicateRows
    .filter((row) => !row.ids.some((id) => allFamilyCandidateIds.has(id)))
    .map((row) => ({
      normalizedName: row.normalized_name,
      city: row.normalized_city,
      region: row.normalized_region,
      classification: "duplicate",
      groupKey: null,
      candidateIds: [...row.ids].sort((left, right) =>
        left.localeCompare(right, "en-US"),
      ),
      evidence: [],
    }));
  return [...duplicateGroups, ...visibleFamilies];
}

