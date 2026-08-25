export type AssistantContextKind =
  | "organization"
  | "contact"
  | "event_family"
  | "booking"
  | "calendar_event"
  | "route"
  | "call_workspace";

export type AssistantSourceReference = {
  id: string;
  kind:
    | "booking"
    | "activity"
    | "follow_up"
    | "package"
    | "resource"
    | "route"
    | "business_knowledge"
    | "derived_fact";
  recordId: string;
  label: string;
  occurredAt: string | null;
};

export type AssistantAnswer = {
  text: string;
  mode: "deterministic" | "cloud" | "offline_cached";
  confidence: "high" | "medium" | "low";
  sources: AssistantSourceReference[];
  needsAdmin: false;
};

export type AssistantProfileSearchResult = {
  id: string;
  kind: "organization" | "contact" | "event_family";
  label: string;
  secondaryLabel: string | null;
  city: string | null;
  region: string | null;
  status: string | null;
  lastContactAt: string | null;
  bookingCount: number | null;
  matchedOn: string[];
};

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
export type LeadScoutEnrichmentStatus = "needs_enrichment" | "enriching" | "enriched" | "enrichment_failed";

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

export type LeadScoutSource = {
  id: string;
  url: string;
  title: string;
  publisher: string | null;
  category:
    | "official_event"
    | "government"
    | "tourism_chamber"
    | "vendor_application"
    | "venue_partner"
    | "news_recap"
    | "social"
    | "review_forum"
    | "other";
  retrievedAt: string;
};

export type LeadScoutCandidateFact = {
  id: string;
  key: string;
  value: unknown;
  category: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  sourceIds: string[];
};

export type LeadScoutCandidate = {
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
  facts: LeadScoutCandidateFact[];
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
  candidates: LeadScoutCandidate[];
  sources: LeadScoutSource[];
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  failureMessage: string | null;
};

export type GeneralAssistantResponse =
  | { kind: "profile_results"; text: string; results: AssistantProfileSearchResult[] }
  | { kind: "lead_discovery"; text: string; run: LeadScoutRunView }
  | { kind: "lead_discovery_clarification"; text: string; runId: string }
  | { kind: "answer"; answer: AssistantAnswer }
  | { kind: "needs_context"; text: string };

export type BookingBrief = {
  headline: string;
  items: Array<{
    key: string;
    text: string;
    confidence: "high" | "medium" | "low";
    sourceIds: string[];
  }>;
  generatedAt: string;
};

export type AssistantContextBundle = {
  context: { kind: AssistantContextKind; recordId: string; label: string };
  sources: AssistantSourceReference[];
  generatedAt: string;
  [key: string]: unknown;
};

export type AssistantConversationMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  answerMode: AssistantAnswer["mode"] | null;
  confidence: AssistantAnswer["confidence"] | null;
  createdAt: string;
  sources: AssistantSourceReference[];
};

export type AssistantConversation = {
  id: string;
  contextKind: AssistantContextKind;
  contextRecordId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantConversationMessage[];
};

export type AssistantAskResponse = {
  answer: AssistantAnswer;
  brief: BookingBrief;
  context: AssistantContextBundle;
  conversationId?: string;
};

export type ActiveAssistantContext = {
  kind: AssistantContextKind;
  recordId: string;
  label?: string;
} | null;