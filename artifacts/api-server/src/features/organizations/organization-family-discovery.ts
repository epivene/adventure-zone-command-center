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

function normalizedReviewName(name: string): string | null {
  const withoutLocationSuffix = name
    .trim()
    .replace(/\s+\([^()\r\n]+,\s*[a-z]{2}\)\s*$/i, "")
    .replace(/\s+\([^()\r\n]+\)\s+[a-z]{2}\s*$/i, "")
    .replace(/\s+-\s+[^,()\r\n]+,\s*[a-z]{2}\s*$/i, "")
    .replace(/^the\s+/i, "")
    .replace(/,\s*the$/i, "");
  return normalizeMatchingText(withoutLocationSuffix);
}

function normalizedRecordLocation(record: OrganizationFamilyRecord): {
  city: string;
  region: string;
  key: string;
} | null {
  const city = normalizeMatchingText(record.city ?? null);
  const region = normalizeMatchingText(record.region ?? null);
  if (!city || !region) return null;
  return { city, region, key: `${city}\u0000${region}` };
}

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

  const byReviewName = new Map<string, OrganizationFamilyRecord[]>();
  for (const record of hydratedRecords) {
    const reviewName = normalizedReviewName(record.name);
    if (!reviewName) continue;
    const bucket = byReviewName.get(reviewName) ?? [];
    bucket.push(record);
    byReviewName.set(reviewName, bucket);
  }
  for (const [reviewName, bucket] of byReviewName) {
    if (bucket.length < 2) continue;
    const rawNames = new Set(
      bucket.map((record) => normalizeMatchingText(record.name)).filter(Boolean),
    );
    if (rawNames.size < 2) continue;
    const candidateIds = bucket
      .map((record) => record.id)
      .sort((left, right) => left.localeCompare(right, "en-US"));
    const candidateIdSet = new Set(candidateIds);
    const alreadyCovered = candidates.some(
      (candidate) =>
        candidate.candidateIds.length === candidateIds.length &&
        candidate.candidateIds.every((id) => candidateIdSet.has(id)),
    );
    if (alreadyCovered) continue;

    const locations = bucket.map(normalizedRecordLocation);
    const completeLocations = locations.filter(
      (location): location is NonNullable<typeof location> => location !== null,
    );
    const sameCompleteLocation =
      completeLocations.length === bucket.length &&
      new Set(completeLocations.map((location) => location.key)).size === 1;
    const firstLocation = sameCompleteLocation ? completeLocations[0]! : null;

    candidates.push({
      normalizedName: reviewName,
      city: firstLocation?.city ?? "",
      region: firstLocation?.region ?? "",
      classification: sameCompleteLocation ? "duplicate" : "ambiguous_location_candidate",
      groupKey: `${sameCompleteLocation ? "duplicate-similar" : "organization-family"}:${candidateIds.join("|")}`,
      candidateIds,
      evidence: [
        {
          family: "name",
          label: sameCompleteLocation
            ? "strongly similar names in the same city and state"
            : "strongly similar organization names",
        },
      ],
    });
  }

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
    const locations = bucket.map((record) => {
      const city = normalizeMatchingText(record.city ?? null);
      const region = normalizeMatchingText(record.region ?? null);
      return city && region ? `${city}\u0000${region}` : null;
    });
    const completeLocations = locations.filter(
      (location): location is string => location !== null,
    );
    if (new Set(completeLocations).size < 2) continue;
    const addresses = bucket
      .map((record) => normalizeMatchingText(record.address1 ?? null))
      .filter((address): address is string => address !== null);
    const hasRepeatedAddress = new Set(addresses).size !== addresses.length;

    const exactCandidateIds = new Set(candidateIds);
    const strongEvidence = candidates
      .filter((candidate) =>
        candidate.candidateIds.some((id) => exactCandidateIds.has(id)),
      )
      .flatMap((candidate) => candidate.evidence)
      .filter((item) => item.family !== "name" && item.family !== "location");
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (
        candidates[index]!.candidateIds.some((id) => exactCandidateIds.has(id))
      ) {
        candidates.splice(index, 1);
      }
    }
    const evidence = [
      { family: "name" as const, label: "exact organization names agree" },
      ...strongEvidence,
      { family: "location" as const, label: "locations differ" },
      ...(hasRepeatedAddress
        ? [{
            family: "address" as const,
            label: "street addresses repeat across different locations",
          }]
        : []),
    ].filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.family === item.family && candidate.label === item.label,
        ) === index,
    );
    candidates.push({
      normalizedName: exactName,
      city: "",
      region: "",
      classification: "ambiguous_location_candidate",
      groupKey: `organization-family:${candidateIds.join("|")}`,
      candidateIds,
      evidence,
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
