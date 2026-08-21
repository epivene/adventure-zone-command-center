type Candidate = {
  eventFamilyId?: string | null;
  parentContext?:
    | { kind: "event_family"; id: string; name: string }
    | { kind: "organization_group"; id: string; name: string }
    | null;
};

export type EventFamilyCandidateStatus = {
  blocked: boolean;
  label: string | null;
  replacementProfileId: string | null;
};

export function eventFamilyCandidateStatus(
  candidate: Candidate,
  familyId: string,
): EventFamilyCandidateStatus {
  if (candidate.eventFamilyId === familyId && familyId) {
    return { blocked: true, label: "Already in this family", replacementProfileId: null };
  }
  if (candidate.eventFamilyId) {
    return { blocked: true, label: "Already in another event family", replacementProfileId: null };
  }
  if (candidate.parentContext?.kind === "organization_group") {
    return {
      blocked: true,
      label: `Retired profile — use ${candidate.parentContext.name} instead`,
      replacementProfileId: candidate.parentContext.id,
    };
  }
  return { blocked: false, label: null, replacementProfileId: null };
}
