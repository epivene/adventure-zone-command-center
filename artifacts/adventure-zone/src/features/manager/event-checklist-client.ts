import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";

export type ManagerChecklistPhase = "pre_event" | "post_event";
export type ManagerChecklistResult = "acceptable" | "needs_work_safe" | "unsafe" | "not_applicable";
export type ManagerChecklistSyncState = "saved_offline" | "syncing" | "synced" | "needs_attention";

export type ManagerChecklistItem = {
  resultId: string;
  itemCode: string;
  label: string;
  scope: "site" | "resource";
  resourceId: string | null;
  resourceName: string | null;
  safetyCritical: boolean;
  result: ManagerChecklistResult | null;
  note: string | null;
  photoCount: number;
  followUpSyncState: "not_required" | "pending" | "synced" | "needs_attention";
};

export type ManagerChecklist = {
  id: string;
  bookingId: string;
  legId: string;
  phase: ManagerChecklistPhase;
  state: "in_progress" | "completed" | "unable_to_complete";
  startedAt: string;
  completedAt: string | null;
  unableReason: string | null;
  items: ManagerChecklistItem[];
};

type ManagerApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export function phaseSlug(phase: ManagerChecklistPhase) {
  return phase === "pre_event" ? "pre-event" : "post-event";
}

export function phaseFromSlug(slug: string): ManagerChecklistPhase | null {
  if (slug === "pre-event" || slug === "pre_event") return "pre_event";
  if (slug === "post-event" || slug === "post_event") return "post_event";
  return null;
}

export async function loadOrStartChecklist(
  managerApi: ManagerApi,
  bookingId: string,
  phase: ManagerChecklistPhase,
): Promise<ManagerChecklist> {
  try {
    const loaded = await managerApi<{ checklist: ManagerChecklist }>(
      `/manager/events/${bookingId}/checklists/${phase}`,
    );
    return loaded.checklist;
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
    if (status !== 404) throw error;
  }
  const started = await managerApi<{ checklist: ManagerChecklist }>(
    `/manager/events/${bookingId}/checklists/${phase}/start`,
    {
      method: "POST",
      body: JSON.stringify({ clientMutationId: crypto.randomUUID() }),
    },
  );
  return started.checklist;
}

export async function queueChecklistAnswer(input: {
  managerApi: ManagerApi;
  bookingId: string;
  legId: string;
  resultId: string;
  result: ManagerChecklistResult;
  note: string | null;
}): Promise<ManagerChecklistSyncState> {
  const mutationId = crypto.randomUUID();
  await queueManagerMutation({
    id: mutationId,
    legId: input.legId,
    method: "PATCH",
    path: `/manager/events/${input.bookingId}/checklist-results/${input.resultId}`,
    body: {
      result: input.result,
      note: input.note,
      clientMutationId: mutationId,
    },
    createdAt: new Date().toISOString(),
  });
  if (!navigator.onLine) return "saved_offline";
  const rows = await flushManagerMutationQueue(input.managerApi);
  const row = rows.find((candidate) => candidate.id === mutationId);
  if (row?.state === "needs_attention") return "needs_attention";
  if (row?.state === "synced") return "synced";
  return "saved_offline";
}

export async function completeChecklist(
  managerApi: ManagerApi,
  bookingId: string,
  phase: ManagerChecklistPhase,
) {
  return managerApi<{ checklist: ManagerChecklist }>(
    `/manager/events/${bookingId}/checklists/${phase}/complete`,
    { method: "POST", body: "{}" },
  );
}

export async function markChecklistUnable(
  managerApi: ManagerApi,
  bookingId: string,
  phase: ManagerChecklistPhase,
  reason: string,
) {
  return managerApi<{ checklist: ManagerChecklist }>(
    `/manager/events/${bookingId}/checklists/${phase}/unable-to-complete`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
