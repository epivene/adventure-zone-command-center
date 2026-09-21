import type { EventProfile } from "@/features/event-profiles/event-profile-repository";

export type ResearchMode = "quick" | "deep";
export type ResearchConfidence = "high" | "medium" | "low";
export type ResearchTargetKind = "organization" | "contact" | "booking" | "event_date_fact";

export type ProfileResearchGap = {
  field: string;
  label: string;
  targetKind: ResearchTargetKind;
  targetId: string | null;
};

export type ProfileResearchKnownFact = {
  key: string;
  value: string;
  source: "crm" | "history";
};

export type ProfileResearchContext = {
  profileId: string;
  profileName: string;
  mode: ResearchMode;
  knownFacts: ProfileResearchKnownFact[];
  searchClues: string[];
  gaps: ProfileResearchGap[];
};

export type ProfileResearchContextInput = {
  profile: EventProfile;
  mode: ResearchMode;
  /**
   * Already-minimized identity clues extracted upstream from history/Assistant
   * data. Never pass raw ACT/activity bodies here.
   */
  historyIdentityClues?: string[];
};

export type ProfileResearchSource = {
  id: string;
  kind: "internal" | "web";
  title: string;
  url: string | null;
  publisher: string | null;
  retrievedAt: string;
  excerpt: string;
};

export type ProfileResearchSuggestion = {
  id: string;
  targetKind: ResearchTargetKind;
  targetId: string | null;
  field: string;
  currentValue: string | null;
  suggestedValue: string;
  confidence: ResearchConfidence;
  rationale: string;
  sourceIds: string[];
  conflict: boolean;
};
