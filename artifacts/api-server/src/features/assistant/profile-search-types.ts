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

export type ProfileSearchRequest = {
  query: string;
  city?: string;
  region?: string;
  packageName?: string;
  overdueFollowUp?: boolean;
  limit: number;
};
