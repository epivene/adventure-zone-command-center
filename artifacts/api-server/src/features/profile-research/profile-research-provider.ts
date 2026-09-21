import type {
  ProfileResearchContext,
  ProfileResearchSource,
  ResearchConfidence,
  ResearchMode,
  ResearchTargetKind,
} from "./profile-research-types";
import type { RelatedEventOpportunity, ResearchFinding } from "./profile-research-discovery";
import type { EventRecurrenceRule } from "@/features/event-date-coverage/event-date-types";

export type ProfileResearchCandidateFact = {
  targetKind: ResearchTargetKind;
  targetId: string | null;
  field: string;
  value: string;
  rationale: string;
  sourceUrls: string[];
};

export type EventDateCandidate = {
  startsOn: string | null;
  endsOn: string | null;
  evidenceKind: "published_exact" | "recognized_recurrence" | "ambiguous";
  recurrenceRule: EventRecurrenceRule | null;
  rationale: string;
  source: ProfileResearchSource;
  confidence: number;
};

export type ProfileResearchProviderResult = {
  identity: {
    confidence: ResearchConfidence;
    rationale: string;
  };
  sources: ProfileResearchSource[];
  candidates: ProfileResearchCandidateFact[];
  eventDateCandidates: EventDateCandidate[];
  findings: ResearchFinding[];
  relatedEvents: RelatedEventOpportunity[];
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
