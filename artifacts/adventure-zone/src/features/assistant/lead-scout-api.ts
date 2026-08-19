import { apiGet, apiPost } from "@/lib/auth-token";
import type { LeadScoutRunView } from "./assistant-types";

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

export async function getLeadScoutRun(runId: string): Promise<LeadScoutRunView> {
  const response = await apiGet<{ run: LeadScoutRunView }>(`/assistant/lead-scout/runs/${runId}`);
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
