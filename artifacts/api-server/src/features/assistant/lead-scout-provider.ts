import type {
  LeadDiscoveryCriteria,
  LeadScoutCandidateInput,
  LeadScoutEvidenceFact,
  LeadScoutSourceInput,
} from "./lead-scout-types";

export interface LeadScoutProvider {
  discoverSources(
    criteria: LeadDiscoveryCriteria,
    signal?: AbortSignal,
  ): Promise<LeadScoutSourceInput[]>;

  discoverCandidates(input: {
    criteria: LeadDiscoveryCriteria;
    sources: LeadScoutSourceInput[];
    signal?: AbortSignal;
  }): Promise<LeadScoutCandidateInput[]>;

  enrichCandidate(input: {
    criteria: LeadDiscoveryCriteria;
    candidate: LeadScoutCandidateInput;
    knownSources: LeadScoutSourceInput[];
    signal?: AbortSignal;
  }): Promise<{
    facts: LeadScoutEvidenceFact[];
    sources: LeadScoutSourceInput[];
    coverageGaps: string[];
  }>;
}
