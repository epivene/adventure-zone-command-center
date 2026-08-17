import { queueManagerMutation } from "@/lib/manager-sync-queue";
import type {
  ManagerAdminQuestion,
  ManagerAssistantAnswer,
  ManagerAssistantContextBundle,
  ManagerAssistantContextRef,
} from "./manager-assistant-types";

type ManagerApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function loadManagerAssistantContext(managerApi: ManagerApi, context: ManagerAssistantContextRef) {
  const params = new URLSearchParams({ kind: context.kind, id: context.recordId });
  return managerApi<{ context: ManagerAssistantContextBundle }>(`/manager/assistant/context?${params}`);
}

export async function askManagerAssistant(managerApi: ManagerApi, context: ManagerAssistantContextRef, question: string) {
  return managerApi<{ context: ManagerAssistantContextBundle; answer: ManagerAssistantAnswer }>("/manager/assistant/ask", {
    method: "POST",
    body: JSON.stringify({ contextKind: context.kind, contextRecordId: context.recordId, question }),
  });
}

export async function listManagerAdminQuestions(managerApi: ManagerApi) {
  return managerApi<{ questions: ManagerAdminQuestion[] }>("/manager/assistant/admin-questions");
}

export async function askAdminFromManager(input: {
  managerApi: ManagerApi;
  legId: string;
  context: ManagerAssistantContextRef;
  question: string;
  urgency: "normal" | "urgent";
  escalationReason: string;
}) {
  const clientMutationId = crypto.randomUUID();
  const body = {
    contextKind: input.context.kind,
    contextRecordId: input.context.recordId,
    question: input.question,
    urgency: input.urgency,
    escalationReason: input.escalationReason,
    clientMutationId,
  };
  try {
    const result = await input.managerApi<{ question: ManagerAdminQuestion & { idempotent?: boolean } }>(
      "/manager/assistant/admin-questions",
      { method: "POST", body: JSON.stringify(body) },
    );
    return { state: "sent" as const, question: result.question };
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : undefined;
    if (status && status < 500) throw error;
    await queueManagerMutation({
      id: clientMutationId,
      legId: input.legId,
      method: "POST",
      path: "/manager/assistant/admin-questions",
      body,
      createdAt: new Date().toISOString(),
    });
    return { state: "saved_offline" as const, question: null };
  }
}
