import type { Task, TaskItem } from "./profile-task-contracts";
export type TaskEvidence = {
  id: string;
  profileId: string;
  eventYear: number | null;
  retrievedAt: string;
  sourceUrl: string | null;
  contactRole: "event_organizer" | "general_office" | "unknown";
  excerpt: string;
  complete?: boolean;
};
export function buildProfileTaskContext(
  task: Task,
  items: TaskItem[],
  evidence: TaskEvidence[],
) {
  const scoped = items.slice(0, 4),
    ids = new Set(scoped.map((i) => i.profileId));
  const context = {
    taskId: task.id,
    objective: task.scope.objective.slice(0, 2000),
    eventYear: task.scope.eventYear,
    requestedFields: task.scope.requestedFields,
    counts: task.counts,
    items: scoped.map((i) => ({
      id: i.id,
      profileId: i.profileId,
      state: i.state,
      reason: i.reason?.slice(0, 500) ?? null,
      evidenceIds: i.evidenceIds.slice(0, 12),
      receiptIds: i.receiptIds.slice(0, 12),
    })),
    evidence: evidence
      .filter((e) => ids.has(e.profileId))
      .slice(0, 8)
      .map((e) => ({
        ...e,
        id: e.id.slice(0, 256),
        profileId: e.profileId,
        sourceUrl: e.sourceUrl?.slice(0, 1000) ?? null,
        excerpt: e.excerpt.slice(0, 1200),
        truncated: e.excerpt.length > 1200,
      })),
    truncated: items.length > 4 || evidence.length > 8,
  };
  while (JSON.stringify(context).length > 24000 && context.evidence.length) {
    context.evidence.pop();
    context.truncated = true;
  }
  return context;
}
export type TaskBatchContext = ReturnType<typeof buildProfileTaskContext>;
export function resolveContinuation(
  tasks: Task[],
):
  | { kind: "resume"; taskId: string }
  | { kind: "choose"; taskIds: string[] }
  | { kind: "none" } {
  const eligible = tasks.filter((t) =>
    ["running", "paused", "waiting_review"].includes(t.state),
  );
  return eligible.length === 1
    ? { kind: "resume", taskId: eligible[0].id }
    : eligible.length > 1
      ? { kind: "choose", taskIds: eligible.map((t) => t.id) }
      : { kind: "none" };
}
/** Completion is conservative: current CRM contact tools cannot verify a named event role. */
export function canCompleteProfileTask(
  task: Task,
  evidence: TaskEvidence[],
  receiptKinds: string[],
  fields: Record<string, unknown>,
): boolean {
  const verified = evidence.filter(
    (e) => e.complete === true && !!e.profileId && !!e.sourceUrl,
  );
  if (!verified.length) return false;
  if (task.scope.completionMode === "sourced_notes")
    return receiptKinds.includes("add_profile_note");
  if (
    task.scope.completionMode !== "profile_fields" ||
    task.scope.eventYear !== null
  )
    return false;
  return (
    receiptKinds.includes("update_profile") &&
    task.scope.requestedFields.length > 0 &&
    task.scope.requestedFields.every(
      (f) =>
        typeof fields[f] === "string" &&
        String(fields[f]).trim().length > 0 &&
        verified.some((e) => e.excerpt.includes(String(fields[f]))),
    )
  );
}
