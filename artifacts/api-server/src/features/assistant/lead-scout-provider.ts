import type {
  LeadDiscoveryCriteria,
  LeadScoutCandidateInput,
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
}
