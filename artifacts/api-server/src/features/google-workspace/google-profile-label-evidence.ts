import type { GoogleLabelSummary } from "./google-api-types";
import { normalizedProfileLabelPath, profileLabelIdentity } from "./google-profile-label-config";
import type { GoogleRelevanceResult } from "./google-relevance-classifier";

type Profile = { id: string; name: string };

// Only exact names inside the approved profile roots supply ownership evidence.
// Unknown aliases remain eligible for the existing matcher; never fuzzy-match
// a label to a similarly named event in another city.
export function profileLabelEvidenceIndex(input: {
  labels: GoogleLabelSummary[];
  approvedLabelIds: Set<string>;
  profiles: Profile[];
}): Map<string, Profile[]> {
  const profilesByName = new Map<string, Profile[]>();
  for (const profile of input.profiles) {
    const name = normalizedProfileLabelPath(profile.name);
    const group = profilesByName.get(name) ?? [];
    group.push(profile);
    profilesByName.set(name, group);
  }
  const index = new Map<string, Profile[]>();
  for (const label of input.labels) {
    if (label.type !== "user" || !input.approvedLabelIds.has(label.id)) continue;
    const identity = profileLabelIdentity(label.name);
    if (identity !== null) index.set(label.id, profilesByName.get(identity) ?? []);
  }
  return index;
}

export function classifyProfileLabelEvidence(input: {
  labelIds: string[];
  index: Map<string, Profile[]>;
  existingThreadTarget?: Profile | null;
}): GoogleRelevanceResult | null {
  const targets = new Map<string, Profile>();
  let unknownLabel = false;
  for (const id of input.labelIds) {
    const profiles = input.index.get(id);
    if (!profiles) continue;
    if (!profiles.length) unknownLabel = true;
    for (const profile of profiles) targets.set(profile.id, profile);
  }
  if (!targets.size) return null;
  const existing = input.existingThreadTarget;
  const conflictingThread = existing && !targets.has(existing.id);
  if (conflictingThread) targets.set(existing.id, existing);
  const conflict = targets.size > 1 || unknownLabel;
  return {
    status: conflict ? "review" : "matched",
    evidenceCodes: [conflict ? "profile_label_conflict" : "exact_profile_label"],
    candidates: [...targets.values()].map(profile => ({...profile,kind:"profile" as const})),
  };
}
