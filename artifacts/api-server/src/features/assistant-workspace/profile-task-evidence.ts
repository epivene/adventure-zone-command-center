import { fingerprint } from "./action-store";
import type { ActionIntent, Queryable, Evidence } from "./contracts";
import type { Task } from "./profile-task-contracts";
export type BoundTaskEvidence = Evidence & {
  profileId: string;
  contactRole: "unknown";
  originalEvidenceId: string;
};
export type TaskChangeProof = {
  profileId: string;
  fingerprint: string;
  evidenceIds: string[];
};
export function changeFingerprint(
  intent: Pick<ActionIntent, "kind" | "arguments" | "expectedRevision">,
) {
  return fingerprint({
    kind: intent.kind,
    arguments: intent.arguments,
    revision: intent.expectedRevision,
  });
}
export async function taskEvidence(
  db: Queryable,
  taskId: string,
  profileId: string,
  ids: string[],
): Promise<BoundTaskEvidence[]> {
  if (!ids.length) return [];
  return (
    await db.query(
      "SELECT data FROM assistant_profile_task_evidence WHERE task_id=$1 AND profile_id=$2 AND evidence_id=ANY($3::text[]) ORDER BY array_position($3::text[],evidence_id)",
      [taskId, profileId, ids],
    )
  ).rows
    .map((r) => r.data)
    .filter(
      (e) =>
        e.profileId === profileId &&
        e.kind === "web" &&
        e.complete === true &&
        e.recordId.length <= 1000 &&
        /^https?:\/\//.test(e.recordId) &&
        Number.isFinite(Date.parse(e.retrievedAt)),
    );
}
export function sourcedTaskNote(task: Task, evidence: BoundTaskEvidence[]) {
  return [
    `Saved research for ${task.scope.eventYear ?? "general profile information"}. A source with an unverified year or role does not verify an event organizer.`,
    ...evidence.map(
      (e) =>
        `Source: ${e.recordId}\nRetrieved: ${e.retrievedAt}\nSource year: ${e.eventYear ?? "unverified"}; contact role: unverified\n${e.text.slice(0, 1200)}${e.text.length > 1200 ? "\n[Excerpt; full research retained]" : ""}`,
    ),
  ]
    .join("\n\n")
    .slice(0, 7900);
}
export async function loadTaskChangeProof(
  db: Queryable,
  task: Task,
  intent: ActionIntent,
): Promise<TaskChangeProof | null> {
  const hash = changeFingerprint(intent);
  const row = (
    await db.query(
      "SELECT evidence_ids FROM assistant_profile_task_change_evidence WHERE task_id=$1 AND profile_id=$2 AND kind=$3 AND fingerprint=$4",
      [task.id, intent.targetId, intent.kind, hash],
    )
  ).rows[0];
  if (!row) return null;
  const evidence = await taskEvidence(
    db,
    task.id,
    intent.targetId,
    row.evidence_ids,
  );
  if (evidence.length !== row.evidence_ids.length || !evidence.length)
    return null;
  if (intent.kind === "add_profile_note") {
    if (
      (intent.arguments as { body?: unknown })?.body !==
      sourcedTaskNote(task, evidence)
    )
      return null;
  } else if (intent.kind === "update_profile") {
    // General static fields only. Event-role/year claims require human review.
    if (
      task.scope.completionMode !== "profile_fields" ||
      task.scope.eventYear !== null
    )
      return null;
    if (
      Object.values(intent.arguments as object).some(
        (v) =>
          typeof v !== "string" ||
          !v.trim() ||
          !evidence.some((e) => e.text.includes(v)),
      )
    )
      return null;
  } else return null;
  return {
    profileId: intent.targetId,
    fingerprint: hash,
    evidenceIds: row.evidence_ids,
  };
}
