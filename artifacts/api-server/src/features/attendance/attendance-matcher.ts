export type AttendanceMatchCandidate = {
  organizationId: string;
  organizationName: string;
  consolidatedIntoId: string | null;
  locationId: string | null;
  city: string | null;
  region: string | null;
};

export type AttendanceMatchSuggestion = {
  importRowId: string;
  organizationId: string | null;
  organizationLocationId: string | null;
  confidence: number;
  reason: string;
  state: "confident" | "pending" | "new_profile_candidate";
};

export function normalizeAttendanceText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function words(value: string) {
  return new Set(normalizeAttendanceText(value).split(" ").filter(Boolean));
}

function nameSimilarity(a: string, b: string) {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

export function findPlausibleAttendanceCandidates(
  eventName: string,
  candidates: AttendanceMatchCandidate[],
) {
  const normalized = normalizeAttendanceText(eventName);
  const active = candidates.filter((candidate) => candidate.consolidatedIntoId === null);
  const exact = active.filter(
    (candidate) => normalizeAttendanceText(candidate.organizationName) === normalized,
  );
  if (exact.length > 0) return exact;

  return active.filter((candidate) => {
    const candidateName = normalizeAttendanceText(candidate.organizationName);
    return (
      candidateName.includes(normalized) ||
      normalized.includes(candidateName) ||
      nameSimilarity(eventName, candidate.organizationName) >= 0.6
    );
  });
}

function normalizedCandidateLocation(candidate: AttendanceMatchCandidate) {
  return normalizeAttendanceText(
    [candidate.city, candidate.region].filter(Boolean).join(" "),
  );
}

export function chooseAttendanceMatch(
  row: { importRowId: string; eventName: string; location: string },
  candidates: AttendanceMatchCandidate[],
): AttendanceMatchSuggestion {
  const active = candidates.filter((candidate) => candidate.consolidatedIntoId === null);
  const normalizedName = normalizeAttendanceText(row.eventName);
  const normalizedLocation = normalizeAttendanceText(row.location);
  const exactName = active.filter(
    (candidate) => normalizeAttendanceText(candidate.organizationName) === normalizedName,
  );
  const exactLocation = exactName.filter(
    (candidate) => normalizedCandidateLocation(candidate) === normalizedLocation,
  );

  if (exactLocation.length === 1) {
    const match = exactLocation[0]!;
    return {
      importRowId: row.importRowId,
      organizationId: match.organizationId,
      organizationLocationId: match.locationId,
      confidence: 1,
      reason: "Exact active profile name and source city/state match exactly.",
      state: "confident",
    };
  }

  if (exactLocation.length > 1) {
    return {
      importRowId: row.importRowId,
      organizationId: null,
      organizationLocationId: null,
      confidence: 0.65,
      reason: "Multiple active profiles or locations have the same exact name and source city/state; owner review is required.",
      state: "pending",
    };
  }

  if (exactName.length > 0) {
    const suggestion = exactName.length === 1 ? exactName[0]! : null;
    return {
      importRowId: row.importRowId,
      organizationId: suggestion?.organizationId ?? null,
      organizationLocationId: suggestion?.locationId ?? null,
      confidence: 0.55,
      reason: "Exact event name found, but the source location does not uniquely match the active profile/location.",
      state: "pending",
    };
  }

  if (active.length > 0) {
    return {
      importRowId: row.importRowId,
      organizationId: null,
      organizationLocationId: null,
      confidence: 0.25,
      reason: "Possible profiles exist, but the event name is not an exact normalized match. Forgiving/fuzzy results are suggestions only.",
      state: "pending",
    };
  }

  return {
    importRowId: row.importRowId,
    organizationId: null,
    organizationLocationId: null,
    confidence: 0,
    reason: "No plausible active profile was found; owner may create or choose a profile during review.",
    state: "new_profile_candidate",
  };
}
