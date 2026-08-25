export type LeadScoutStatus =
  | "interpreting"
  | "crm_search"
  | "crm_ready"
  | "running"
  | "stopping"
  | "stopped"
  | "complete"
  | "failed";

export type LeadScoutStage =
  | "interpreting"
  | "crm_search"
  | "source_discovery"
  | "candidate_discovery"
  | "candidate_enrichment"
  | "crm_compare"
  | "fit_rank"
  | "complete";

export type LeadScoutCrmMatchStatus = "existing" | "possible_match" | "new_prospect";
export type LeadScoutSourceCategory =
  | "official_event"
  | "government"
  | "tourism_chamber"
  | "vendor_application"
  | "venue_partner"
  | "news_recap"
  | "social"
  | "review_forum"
  | "other";

export type LeadScoutEvidenceCategory =
  | "identity"
  | "schedule"
  | "vendor"
  | "attendance"
  | "logistics"
  | "recurrence"
  | "social_review"
  | "competition"
  | "contact";

export type LeadScoutEvidenceFact = {
  key: string;
  value: string;
  category: LeadScoutEvidenceCategory;
  confidence: "high" | "medium" | "low";
  sourceUrls: string[];
  rationale: string;
};

export type LeadScoutFitInput = {
  eventName: string;
  eventType: string | null;
  startsAt: string | null;
  endsAt: string | null;
  applicationDeadline: string | null;
  now: Date;
  hasPublicSource: boolean;
  hasFamilySignal: boolean;
  hasAdultSpecialInterestSignal?: boolean;
  hasOutdoorSignal: boolean;
  hasVendorPath: boolean;
  hasEntertainmentPath: boolean;
  hasOrganizerContact: boolean;
  hasAttendanceEvidence: boolean;
  attendanceScale?: "large" | "medium" | "small" | "unknown";
  hasLogisticsEvidence: boolean;
  hasExclusiveCarnivalProvider: boolean;
  existenceConfidence: "high" | "medium" | "low";
};

export type LeadScoutEnrichmentStatus =
  | "needs_enrichment"
  | "enriching"
  | "enriched"
  | "enrichment_failed";

export type RadiusScoutCriteriaScope = {
  mode: "radius";
  anchor: {
    kind: "booking" | "event_family" | "manual" | "candidate";
    recordId?: string;
    label: string;
    city?: string;
    region?: string;
    address?: string;
    latitude: number;
    longitude: number;
  };
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  categories: string[];
  historyFilter: "all" | "hide_booked" | "hide_booked_and_dismissed";
  searchPlaces: Array<{
    name: string;
    placeType: string;
    distanceMiles: number;
  }>;
  searchAreaIncomplete: boolean;
};

export type LeadDiscoveryCriteria = {
  originalQuestion: string;
  dateFrom: string | null;
  dateThrough: string | null;
  month: number | null;
  year: number | null;
  regions: string[];
  cities: string[];
  geoMode: "regions" | "corridor" | "route" | "radius" | "unspecified";
  routeId: string | null;
  legId: string | null;
  eventKeywords: string[];
  fitIntent: "bookable_event" | "vendor_opportunity" | "either";
  radiusScope?: RadiusScoutCriteriaScope;
};

export type LeadDiscoveryInterpretation =
  | { kind: "criteria"; criteria: LeadDiscoveryCriteria; summary: string }
  | { kind: "needs_clarification"; message: string; partial: Partial<LeadDiscoveryCriteria> };

export type AssistantLeadMatch = {
  organizationId: string;
  bookingId: string | null;
  label: string;
  city: string | null;
  region: string | null;
  dateFrom: string | null;
  dateThrough: string | null;
  dateConfidence: "confirmed" | "likely_recurring" | "unknown";
  status: string | null;
  relationshipSummary: string | null;
  reasons: string[];
  fitScore: number;
};

export type LeadScoutProgress = {
  label: string | null;
  sourcesChecked: number;
  candidatesFound: number;
  candidatesEnriched: number;
  candidatesCompared: number;
};

export type LeadScoutProgressPatch = Partial<LeadScoutProgress> & { stage?: LeadScoutStage };

export type LeadScoutSourceInput = {
  url: string;
  title: string;
  publisher: string | null;
  category: LeadScoutSourceCategory;
  retrievedAt: string;
  excerpt?: string;
};

export type LeadScoutSourceView = {
  id: string;
  url: string;
  title: string;
  publisher: string | null;
  category: LeadScoutSourceCategory;
  retrievedAt: string;
};

export type LeadScoutCandidateInput = {
  name: string;
  city: string | null;
  region: string | null;
  venue: string | null;
  startsAt: string | null;
  endsAt: string | null;
  website: string | null;
  eventType: string | null;
  rationale: string | null;
};

export type LeadScoutCandidateFactView = {
  id: string;
  key: string;
  value: unknown;
  category: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  sourceIds: string[];
};

export type LeadScoutCandidateView = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  venue: string | null;
  startsAt: string | null;
  endsAt: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  organizerPhone: string | null;
  website: string | null;
  eventType: string | null;
  recurrenceSummary: string | null;
  attendanceSummary: string | null;
  vendorSummary: string | null;
  applicationDeadline: string | null;
  fitScore: number | null;
  fitRationale: string | null;
  fitReasons: string[];
  fitCautions: string[];
  crmMatchStatus: LeadScoutCrmMatchStatus;
  matchedOrganizationId: string | null;
  matchedBookingId: string | null;
  reviewStatus: "unreviewed" | "shortlisted" | "dismissed" | "saved";
  enrichmentStatus: LeadScoutEnrichmentStatus;
  coverageGaps: string[];
  enrichmentError: string | null;
  enrichedAt: string | null;
  deepenRequestedAt: string | null;
  savedOrganizationId: string | null;
  savedBookingId: string | null;
  facts: LeadScoutCandidateFactView[];
};

export type LeadScoutRunView = {
  id: string;
  originalQuestion: string;
  criteria: LeadDiscoveryCriteria | null;
  criteriaSummary: string | null;
  status: LeadScoutStatus;
  stage: LeadScoutStage;
  progress: LeadScoutProgress;
  crmMatches: AssistantLeadMatch[];
  candidates: LeadScoutCandidateView[];
  sources: LeadScoutSourceView[];
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  failureMessage: string | null;
};

export type LeadScoutWorkClaim = {
  runId: string;
  actorId: string;
  criteria: LeadDiscoveryCriteria;
  status: "running" | "stopping";
  stage: LeadScoutStage;
  workerId: string;
  leaseExpiresAt: string;
};