import { apiGet, apiPost } from "@/lib/auth-token";
import type { LeadScoutRunView } from "./assistant-types";

export type ScoutEventCategory =
  | "fair"
  | "festival"
  | "rodeo"
  | "powwow"
  | "community_celebration"
  | "car_show"
  | "expo_show"
  | "parade"
  | "other_family_community";

export type ScoutHistoryFilter = "all" | "hide_booked" | "hide_booked_and_dismissed";

export type RadiusScoutRequest = {
  anchor: {
    kind: "booking" | "event_family" | "manual" | "candidate";
    recordId?: string;
    label: string;
    city?: string;
    region?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: ScoutHistoryFilter;
};

export type LeadScoutSaveSubmission = {
  accepted: {
    name: string;
    city: string;
    region: string;
    startsAt: string | null;
    endsAt: string | null;
    website: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  };
  nextActionKind: "call" | "email" | "prepare_quote";
  nextActionDueAt: string;
};

export type LeadScoutSaveResult =
  | {
      kind: "created";
      profileId: string;
      bookingId: string;
      run: LeadScoutRunView;
    }
  | {
      kind: "duplicate";
      match: {
        status: "existing" | "possible_match";
        organizationId: string;
        bookingId?: string;
        matchedName: string;
      };
      run: LeadScoutRunView;
    };

function isTransientFetchFailure(error: unknown) {
  return error instanceof TypeError && /failed to fetch|network|load failed|networkerror/i.test(error.message);
}

async function transientFetchRetry<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [500, 1000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientFetchFailure(error) || attempt >= delays.length) throw error;
      await new Promise<void>((resolve) => window.setTimeout(resolve, delays[attempt]));
    }
  }
}

export async function startRadiusLeadScout(input: RadiusScoutRequest): Promise<LeadScoutRunView> {
  const response = await apiPost<{ run: LeadScoutRunView }>("/assistant/lead-scout/radius", input);
  return response.run;
}

export async function getLeadScoutRun(runId: string): Promise<LeadScoutRunView> {
  const response = await transientFetchRetry(() =>
    apiGet<{ run: LeadScoutRunView }>(`/assistant/lead-scout/runs/${runId}`),
  );
  return response.run;
}

export async function getLatestLeadScoutRun(): Promise<LeadScoutRunView | null> {
  const response = await apiGet<{ run: LeadScoutRunView | null }>("/assistant/lead-scout/runs/latest");
  return response.run;
}

export async function startLeadScout(runId: string): Promise<LeadScoutRunView> {
  const response = await apiPost<{ run: LeadScoutRunView }>(`/assistant/lead-scout/runs/${runId}/start`, {});
  return response.run;
}

export async function stopLeadScout(runId: string): Promise<LeadScoutRunView> {
  const response = await apiPost<{ run: LeadScoutRunView }>(`/assistant/lead-scout/runs/${runId}/stop`, {});
  return response.run;
}

export async function continueLeadScout(runId: string): Promise<LeadScoutRunView> {
  const response = await apiPost<{ run: LeadScoutRunView }>(`/assistant/lead-scout/runs/${runId}/continue`, {});
  return response.run;
}

export async function deepenLeadScoutCandidate(runId: string, candidateId: string): Promise<LeadScoutRunView> {
  const response = await apiPost<{ run: LeadScoutRunView }>(
    `/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/deepen`,
    {},
  );
  return response.run;
}

export async function dismissLeadScoutCandidate(runId: string, candidateId: string): Promise<LeadScoutRunView> {
  const response = await apiPost<{ run: LeadScoutRunView }>(
    `/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/dismiss`,
    {},
  );
  return response.run;
}

export async function saveLeadScoutCandidate(
  runId: string,
  candidateId: string,
  submission: LeadScoutSaveSubmission,
): Promise<LeadScoutSaveResult> {
  return apiPost<LeadScoutSaveResult>(
    `/assistant/lead-scout/runs/${runId}/candidates/${candidateId}/save`,
    submission,
  );
}