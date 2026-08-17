import { apiGet, apiPost } from "@/lib/auth-token";

import type {
  ActiveAssistantContext,
  AssistantAskResponse,
  AssistantContextBundle,
  BookingBrief,
} from "./assistant-types";

function params(context: Exclude<ActiveAssistantContext, null>): string {
  return new URLSearchParams({
    kind: context.kind,
    id: context.recordId,
  }).toString();
}

export async function getAssistantContext(
  context: Exclude<ActiveAssistantContext, null>,
): Promise<AssistantContextBundle> {
  const response = await apiGet<{ context: AssistantContextBundle }>(
    `/assistant/context?${params(context)}`,
  );
  return response.context;
}

export async function getBookingBrief(
  context: Exclude<ActiveAssistantContext, null>,
): Promise<BookingBrief> {
  const response = await apiGet<{ brief: BookingBrief }>(
    `/assistant/brief?${params(context)}`,
  );
  return response.brief;
}

export async function askBookingAssistant(input: {
  context: Exclude<ActiveAssistantContext, null>;
  question: string;
}): Promise<AssistantAskResponse> {
  return apiPost<AssistantAskResponse>("/assistant/ask", {
    contextKind: input.context.kind,
    contextRecordId: input.context.recordId,
    question: input.question,
  });
}
