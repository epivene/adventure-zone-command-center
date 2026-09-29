import type { Queryable, Screenshot } from "./contracts";
import { RunStore, type RunInput } from "./run-store";
import { validateSelectionAccess } from "./selection-access";

/** Caller owns the transaction: profile validation, scope and message commit together. */
export async function submitScopedMessage(
  db: Queryable,
  input: Omit<RunInput, "sourceMessageId">,
  text: string,
  attachments: Screenshot[],
) {
  const locked = await db.query(
    "SELECT id FROM assistant_workspace_conversations WHERE id=$1 AND actor_id=$2 FOR UPDATE",
    [input.conversationId, input.actor.id],
  );
  if (!locked.rows[0]) throw new Error("ASSISTANT_ACCESS_DENIED");
  const runs = new RunStore(db);
  const existing = await runs.findSubmitted(
    input.actor.id,
    input.conversationId,
    input.requestKey,
    text,
    attachments,
    input.selection,
  );
  if (existing) return existing;
  await validateSelectionAccess(db, input.actor, input.selection);
  const run = await runs.submit(input, text, attachments);
  await db.query(
    "UPDATE assistant_workspace_conversations SET selection=$3::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND actor_id=$2",
    [input.conversationId, input.actor.id, JSON.stringify(input.selection)],
  );
  return run;
}
