import { randomUUID } from "node:crypto";
import {
  activeConnection,
  requireConnectionScope,
  transaction,
  ConnectionError,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type MutationKey,
} from "./contracts";
import { OperationStore } from "./operation-store";
import {
  FollowUpWorkflow,
  snoozeInput,
  resolveInput,
  planInput,
  decideInput,
} from "../follow-ups/workflow-service";
import { WorkflowError } from "../follow-ups/workflow-types";
import {
  comContextInput,
  readComDraftContext,
  comPreviewInput,
  previewComDraft,
} from "../follow-ups/com-draft-context";
import { queueInput } from "../follow-ups/work-queue";
export {
  snoozeInput,
  resolveInput,
  planInput,
  decideInput,
  comContextInput,
  queueInput,
  comPreviewInput,
};
export class ConnectionFollowUpWorkflow {
  constructor(private db: ConnectionDatabase) {}
  async preview(p: ConnectionPrincipal, raw: unknown) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const result = await previewComDraft(this.db, raw);
    await activeConnection(this.db, p);
    return result;
  }
  async queue(p: ConnectionPrincipal, raw: unknown) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const result = await new FollowUpWorkflow({
      query: this.db.query.bind(this.db),
      transaction: (fn) => transaction(this.db, fn),
    }).list(raw);
    await activeConnection(this.db, p);
    return result;
  }
  async context(p: ConnectionPrincipal, raw: unknown) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const result = await readComDraftContext(this.db, raw);
    await activeConnection(this.db, p);
    return result;
  }
  async mutate(
    p: ConnectionPrincipal,
    key: MutationKey,
    method: "snooze" | "resolve" | "plan" | "decide",
    raw: unknown,
  ) {
    requireConnectionScope(p, "followups:write");
    const input = {
      snooze: snoozeInput,
      resolve: resolveInput,
      plan: planInput,
      decide: decideInput,
    }[method].parse(raw);
    if ("finalStatus" in input && input.finalStatus)
      requireConnectionScope(p, "crm:update");
    try {
      return await new OperationStore(this.db).perform(
        p,
        `followup_workflow_${method}`,
        key,
        input,
        async (tx) => {
          const workflow = new FollowUpWorkflow({
            query: tx.query.bind(tx),
            transaction: (fn) => fn(tx),
          });
          const value = await workflow[method](input);
          return {
            operationId: randomUUID(),
            recordId: input.id,
            href: "/today",
            revision: String(value.revision),
            savedAt: new Date().toISOString(),
            value,
          };
        },
      );
    } catch (error) {
      if (error instanceof WorkflowError)
        throw new ConnectionError(error.code, error.status, error.message);
      throw error;
    }
  }
}
