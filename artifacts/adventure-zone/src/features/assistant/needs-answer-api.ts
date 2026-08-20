import { apiGet, apiPost } from "@/lib/auth-token";

export type NeedsAnswerStatus = "open" | "resolved";

export type NeedsAnswerItem = {
  id: string;
  question: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
  callSessionId: string | null;
  userNote: string | null;
  status: NeedsAnswerStatus;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export async function saveNeedsAnswer(input: {
  question: string;
  organizationId?: string | null;
  contactId?: string | null;
  bookingId?: string | null;
  followUpId?: string | null;
  callSessionId?: string | null;
  userNote?: string | null;
}): Promise<NeedsAnswerItem> {
  const response = await apiPost<{ item: NeedsAnswerItem }>("/needs-answer", input);
  return response.item;
}

export async function listNeedsAnswers(status?: NeedsAnswerStatus): Promise<NeedsAnswerItem[]> {
  const query = status ? `?${new URLSearchParams({ status }).toString()}` : "";
  const response = await apiGet<{ items: NeedsAnswerItem[] }>(`/needs-answer${query}`);
  return response.items;
}

export async function resolveNeedsAnswer(id: string, resolution: string): Promise<NeedsAnswerItem> {
  const response = await apiPost<{ item: NeedsAnswerItem }>(
    `/needs-answer/${encodeURIComponent(id)}/resolve`,
    { resolution },
  );
  return response.item;
}
