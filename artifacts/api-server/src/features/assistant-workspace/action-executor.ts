import type { ActionIntent, RunContext, ToolResult, Grant } from "./contracts";
import { ActionStore } from "./action-store";
import { assertMutationGrant } from "./record-tools";
import { blocked } from "./read-tools";
export interface MutationAdapter {
  rollbackErrorCodes?: readonly string[];
  validate(context: RunContext, intent: ActionIntent): Promise<void>;
  apply(context: RunContext, intent: ActionIntent): Promise<ToolResult>;
  reconcile?(context: RunContext, intent: ActionIntent): Promise<ToolResult>;
}
export class ActionExecutor {
  constructor(
    private readonly ownerId: string,
    private readonly store: ActionStore,
    private readonly adapters: Record<string, MutationAdapter>,
    private readonly taskGrant?: (
      context: RunContext,
      intent: ActionIntent,
    ) => Promise<Grant | null>,
    private readonly taskGuard?: (
      context: RunContext,
      intent: ActionIntent,
    ) => Promise<void>,
  ) {}
  async execute(
    context: RunContext,
    intent: ActionIntent,
  ): Promise<ToolResult> {
    if (
      context.actor.id !== this.ownerId ||
      intent.actorId !== context.actor.id ||
      intent.conversationId !== context.conversationId
    )
      return blocked("ASSISTANT_ACCESS_DENIED");
    const adapter = this.adapters[intent.kind];
    if (!adapter) return blocked("ASSISTANT_CAPABILITY_UNAVAILABLE");
    const action = await this.store.prepare(intent);
    if (action.status === "succeeded") {
      const previous = action.result as ToolResult;
      if (
        action.kind === "send_draft" &&
        previous.code === "ASSISTANT_TRACKING_REPAIR_REQUIRED" &&
        adapter.reconcile
      ) {
        const repaired = await adapter.reconcile(context, action);
        if (
          repaired.status === "ok" &&
          repaired.receipts[0]?.id === previous.receipts[0]?.id
        ) {
          await this.store.repairTracking(
            context.actor.id,
            action.id,
            previous,
            repaired,
          );
          return repaired;
        }
      }
      return previous;
    }
    if (action.status === "provider_started" || action.status === "uncertain") {
      const reconciled = await adapter.reconcile?.(context, action);
      if (reconciled?.status === "ok" && reconciled.receipts.length) {
        await this.store.reconcile(context.actor.id, action.id, reconciled);
        return reconciled;
      }
      return {
        status: "uncertain",
        data: { actionId: action.id },
        evidence: [],
        receipts: [],
        code: "ASSISTANT_ACTION_RECONCILIATION_REQUIRED",
      };
    }
    try {
      await this.taskGuard?.(context, action);
    } catch (error) {
      return blocked(
        error instanceof Error ? error.message : "ASSISTANT_ACCESS_DENIED",
      );
    }
    try {
      const grant =
        context.taskId && !context.taskReview
          ? await this.taskGrant?.(context, action)
          : null;
      assertMutationGrant(
        grant ? [...context.grants, grant] : context.grants,
        action,
      );
    } catch {
      return {
        ...blocked("ASSISTANT_APPROVAL_REQUIRED"),
        data: {
          actionId: action.id,
          kind: action.kind,
          targetId: action.targetId,
          revision: action.expectedRevision,
          arguments: action.arguments,
        },
      };
    }
    if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
    if (
      !action.kind.includes("calendar_event") &&
      action.connectionId !== null &&
      action.connectionId !== context.actor.connectionId
    )
      return blocked("ASSISTANT_CONNECTION_CHANGED");
    await adapter.validate(context, action);
    const claimed = await this.store.claim(
      context.actor.id,
      action.id,
      context.runId,
    );
    if (!claimed) return blocked("ASSISTANT_ACTION_BUSY");
    // A crash after this checkpoint requires readback, including database-only mutations.
    // This deliberately trades automatic replay for avoiding duplicate irreversible work.
    if (context.signal.aborted) {
      await this.store.checkpoint(
        context.actor.id,
        action.id,
        claimed.leaseToken,
        "cancelled",
        null,
      );
      return blocked("ASSISTANT_CANCELLED");
    }
    try {
      await adapter.validate(context, action);
    } catch (error) {
      await this.store.checkpoint(
        context.actor.id,
        action.id,
        claimed.leaseToken,
        "failed",
        blocked("ASSISTANT_VALIDATION_CHANGED"),
      );
      throw error;
    }
    await this.store.checkpoint(
      context.actor.id,
      action.id,
      claimed.leaseToken,
      "provider_started",
      null,
    );
    try {
      const output = await adapter.apply(context, action);
      if (
        action.kind === "send_draft" &&
        output.code === "ASSISTANT_SEND_NOT_DISPATCHED"
      ) {
        await this.store.checkpoint(
          context.actor.id,
          action.id,
          claimed.leaseToken,
          "failed",
          output,
        );
        return output;
      }
      if (output.status === "ok" && output.receipts.length) {
        await this.store.checkpoint(
          context.actor.id,
          action.id,
          claimed.leaseToken,
          "succeeded",
          output,
        );
        return output;
      }
      await this.store.checkpoint(
        context.actor.id,
        action.id,
        claimed.leaseToken,
        "uncertain",
        output,
      );
      return output;
    } catch (error) {
      if (
        error instanceof Error &&
        adapter.rollbackErrorCodes?.includes(error.message)
      ) {
        const output = blocked(error.message);
        await this.store.checkpoint(
          context.actor.id,
          action.id,
          claimed.leaseToken,
          "failed",
          output,
        );
        return output;
      }
      const output: ToolResult = {
        status: "uncertain",
        data: { actionId: action.id },
        evidence: [],
        receipts: [],
        code: "ASSISTANT_ACTION_RECONCILIATION_REQUIRED",
      };
      await this.store
        .checkpoint(
          context.actor.id,
          action.id,
          claimed.leaseToken,
          "uncertain",
          output,
        )
        .catch(() => {});
      return output;
    }
  }
}
