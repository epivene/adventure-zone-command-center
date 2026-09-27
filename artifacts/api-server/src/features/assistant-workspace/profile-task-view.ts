import type { Queryable } from "./contracts";
import type { Task } from "./profile-task-contracts";
export async function profileTaskView(db: Queryable, task: Task) {
  const profiles = (
    await db.query("SELECT * FROM organizations WHERE id=ANY($1::uuid[])", [
      task.scope.profileIds,
    ])
  ).rows;
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const actions = (
    await db.query(
      `SELECT * FROM assistant_workspace_actions WHERE actor_id=$1 AND id=ANY($2::uuid[])`,
      [task.actorId, task.items.flatMap((i) => i.actionIds)],
    )
  ).rows;
  const runs = (
    await db.query(
      "SELECT r.checkpoint FROM assistant_workspace_runs r JOIN assistant_profile_task_runs b ON b.run_id=r.id WHERE b.task_id=$1",
      [task.id],
    )
  ).rows;
  const evidence = runs.flatMap((r) => r.checkpoint?.turn?.evidence ?? []);
  const changes = actions
    .filter(
      (a) =>
        (a.status === "prepared" ||
          (a.status === "failed" &&
            a.result?.code === "ASSISTANT_VERSION_CONFLICT")) &&
        task.items.some(
          (i) =>
            ["awaiting_review", "needs_review"].includes(i.state) &&
            i.actionIds.includes(a.id),
        ),
    )
    .map((a) => {
      const p = byId.get(a.target_id);
      const current = p
        ? {
            ...p,
            address1: p.address_1,
            address2: p.address_2,
            postalCode: p.postal_code,
          }
        : {};
      return {
        actionId: a.id,
        itemId: task.items.find((i) => i.profileId === a.target_id)?.id,
        profileName:
          p?.name ??
          task.items.find((i) => i.profileId === a.target_id)
            ?.profileNameSnapshot ??
          "Unavailable profile",
        kind: a.kind,
        revision: a.expected_revision,
        available: !!p && !p.consolidated_into_id && a.status === "prepared",
        conflict:
          a.status === "failed"
            ? "Record changed; retry this profile to prepare a current proposal."
            : null,
        fields: Object.entries(a.arguments ?? {}).map(([field, value]) => ({
          field,
          oldValue:
            a.kind === "add_profile_note" ? null : (current[field] ?? null),
          newValue: value,
        })),
        sources: [
          ...new Set(
            evidence
              .filter(
                (e) =>
                  task.items
                    .find((i) => i.profileId === a.target_id)
                    ?.evidenceIds.includes(e.id) &&
                  e.kind === "web" &&
                  /^https?:\/\//.test(e.recordId),
              )
              .map((e) => e.recordId),
          ),
        ].slice(0, 8) as string[],
      };
    });
  return {
    ...task,
    items: task.items.map((i) => ({
      ...i,
      profileName:
        byId.get(i.profileId)?.name ??
        i.profileNameSnapshot ??
        "Unavailable profile",
    })),
    changes,
  };
}
