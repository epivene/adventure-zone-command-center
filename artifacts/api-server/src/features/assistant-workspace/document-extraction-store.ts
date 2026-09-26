import type { Queryable, RunContext, ToolResult } from "./contracts";
import { createHash } from "node:crypto";
import { blocked } from "./read-tools";
const uncertain = (): ToolResult => ({
  ...blocked("ASSISTANT_DOCUMENT_EXTRACTION_UNCERTAIN"),
  status: "uncertain",
  usageUnknown: true,
  data: {
    complete: false,
    reviewRequired: true,
    message:
      "A previous extraction may still be running or its usage could not be verified. It will not be repeated automatically.",
  },
});
export class DocumentExtractionStore {
  constructor(private readonly db: Queryable) {}
  async execute(
    context: RunContext,
    key: string,
    work: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const run = await this.db.query(
      "SELECT id FROM assistant_workspace_runs WHERE id=$1 AND actor_id=$2 AND conversation_id=$3",
      [context.runId, context.actor.id, context.conversationId],
    );
    if (!run.rows.length || context.actor.role !== "owner")
      throw new Error("ASSISTANT_RUN_NOT_FOUND");
    if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
    const hash = createHash("sha256")
      .update(JSON.stringify([context.actor.id, key]))
      .digest("hex");
    const inserted = await this.db.query(
      `INSERT INTO assistant_workspace_document_extractions(cache_key,actor_id,run_id,call_id,state)
      VALUES($1,$2,$3,$4,'started') ON CONFLICT(cache_key) DO NOTHING RETURNING created_at`,
      [hash, context.actor.id, context.runId, context.toolCallId ?? null],
    );
    if (!inserted.rows.length) {
      const prior = (
        await this.db.query(
          "SELECT * FROM assistant_workspace_document_extractions WHERE cache_key=$1 AND actor_id=$2",
          [hash, context.actor.id],
        )
      ).rows[0];
      if (!prior || prior.state !== "completed" || !prior.result)
        return uncertain();
      const output = structuredClone(prior.result) as ToolResult;
      // Recovery of the originating call still owes its usage to that run's checkpoint.
      // A later tool call or run pays no new tokens for this cached artifact.
      if (
        !context.toolCallId ||
        prior.run_id !== context.runId ||
        prior.call_id !== context.toolCallId
      ) {
        delete output.usage;
        delete output.costCalls;
      }
      output.data = { ...(output.data as object), cacheHit: true };
      return output;
    }
    try {
      const output = await work();
      if (output.receipts.length || JSON.stringify(output).length > 1200000)
        throw new Error("ASSISTANT_EXTRACTION_INVALID");
      output.data = {
        ...(output.data as object),
        cacheHit: false,
        extractedAt: new Date().toISOString(),
      };
      await this.db.query(
        "UPDATE assistant_workspace_document_extractions SET state='completed',result=$3::jsonb,updated_at=now() WHERE cache_key=$1 AND actor_id=$2",
        [hash, context.actor.id, JSON.stringify(output)],
      );
      return output;
    } catch {
      // Leave a durable unresolved claim: another call/run/model cannot rebill it.
      return uncertain();
    }
  }
}
