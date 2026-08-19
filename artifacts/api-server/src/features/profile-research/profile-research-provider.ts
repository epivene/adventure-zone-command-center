import type {
  ProfileResearchContext,
  ProfileResearchSource,
  ResearchConfidence,
  ResearchMode,
  ResearchTargetKind,
} from "./profile-research-types";

export type ProfileResearchCandidateFact = {
  targetKind: ResearchTargetKind;
  targetId: string | null;
  field: string;
  value: string;
  rationale: string;
  sourceUrls: string[];
};

export type ProfileResearchProviderResult = {
  identity: {
    confidence: ResearchConfidence;
    rationale: string;
  };
  sources: ProfileResearchSource[];
  candidates: ProfileResearchCandidateFact[];
  deepSummary: string | null;
};

export interface ProfileResearchProvider {
  research(input: {
    context: ProfileResearchContext;
    mode: ResearchMode;
  }): Promise<ProfileResearchProviderResult>;
}

export class ProfileResearchProviderUnavailableError extends Error {
  constructor(message = "Public web research is not configured.") {
    super(message);
    this.name = "ProfileResearchProviderUnavailableError";
  }
}
