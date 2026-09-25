import { randomUUID } from "node:crypto";
import type { Evidence, ModelPort, ToolRegistry } from "./contracts";
import type { ConversationStore } from "./conversation-store";
import { runTurn } from "./orchestrator";
import type { RunStore } from "./run-store";
export interface WorkerDependencies {
  runs: RunStore;
  conversations: ConversationStore;
  model: ModelPort;
  modelFor?: (model: string | undefined) => ModelPort;
  tools: ToolRegistry;
  allowedActorIds: string[];
  maxSteps: number;
  maxTokens: number;
  evidence(
    organizationId: string | null,
    eventYear: number | null,
  ): Promise<Evidence[]>;
}
export function createWorkspaceWorker(deps: WorkerDependencies) {
  let busy = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const active = new Map<string, AbortController>();
  const workerId = randomUUID();
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const run = await deps.runs.claim(workerId);
      if (!run) return;
      const control = new AbortController();
      active.set(run.id, control);
      const heartbeat = setInterval(() => {
        void deps.runs
          .check(run.actorId, run.id, run.leaseToken)
          .catch(() => control.abort());
      }, 10000);
      heartbeat.unref();
      try {
        if (!deps.allowedActorIds.includes(run.actorId))
          throw new Error("ASSISTANT_ACCESS_DENIED");
        if (run.cancelRequested) control.abort();
        const savedContext =
          run.turn?.context ??
          (await deps.conversations.context(
            run.actorId,
            run.conversationId,
            run.input.sourceMessageId,
          ));
        if (savedContext.sourceMessageId !== run.input.sourceMessageId)
          throw new Error("ASSISTANT_SOURCE_MESSAGE_MISSING");
        await deps.runs.check(run.actorId, run.id, run.leaseToken);
        await deps.conversations.saveSummary(
          run.actorId,
          run.conversationId,
          savedContext.memory,
        );
        await deps.runs.event(run.actorId, run.id, run.leaseToken, "progress", {
          text: "Reading conversation and current business rules",
        });
        const model = deps.modelFor?.(run.input.model) ?? deps.model;
        const output = await runTurn(
          {
            actor: run.input.actor,
            conversationId: run.conversationId,
            runId: run.id,
            selection: run.input.selection,
            grants: run.input.grants,
            signal: control.signal,
          },
          {
            next: (input) =>
              model.next({
                ...input,
                attachmentScope: {
                  actorId: run.actorId,
                  conversationId: run.conversationId,
                  sourceMessageId: run.input.sourceMessageId,
                },
              }),
          },
          {
            definitions: deps.tools.definitions.bind(deps.tools),
            async execute(context, call) {
              await deps.runs.check(run.actorId, run.id, run.leaseToken);
              await deps.runs.event(
                run.actorId,
                run.id,
                run.leaseToken,
                "tool",
                { name: call.name, status: "started" },
              );
              const result = await deps.tools.execute(context, call);
              await deps.runs.event(
                run.actorId,
                run.id,
                run.leaseToken,
                "tool",
                {
                  name: call.name,
                  status: result.status,
                  receipts: result.receipts,
                  code: result.code,
                },
              );
              return result;
            },
          },
          {
            load: async () => ({
              turns: savedContext.turns,
              context: savedContext,
              state: run.input.selection,
              evidence: (
                await Promise.all(
                  (run.input.selection.organizationIds.length
                    ? run.input.selection.organizationIds
                    : [null]
                  ).map((id) =>
                    deps.evidence(id, run.input.selection.eventYear),
                  ),
                )
              ).flat(),
              checkpoint: run.turn,
            }),
            save: (turn) =>
              deps.runs.save(run.actorId, run.id, run.leaseToken, turn),
            check: () => deps.runs.check(run.actorId, run.id, run.leaseToken),
          },
          { maxSteps: deps.maxSteps, maxTokens: deps.maxTokens },
        );
        await deps.conversations.append(
          run.actorId,
          run.conversationId,
          run.requestKey,
          { role: "assistant", text: output.text.slice(0, 20000) },
        );
        await deps.runs.event(
          run.actorId,
          run.id,
          run.leaseToken,
          "complete",
          output,
        );
        await deps.runs.finish(
          run.actorId,
          run.id,
          run.leaseToken,
          output.status,
        );
      } catch (error) {
        const cancelled =
          control.signal.aborted ||
          (error instanceof Error && error.message === "ASSISTANT_CANCELLED");
        // Never expose provider payloads, tokens or source bodies in public errors.
        await deps.runs.event(run.actorId, run.id, run.leaseToken, "error", {
          code: cancelled
            ? "ASSISTANT_CANCELLED"
            : error instanceof Error &&
                /^ASSISTANT_SCREENSHOT_(READ_FAILED|CHANGED|NOT_FOUND)$/.test(
                  error.message,
                )
              ? "ASSISTANT_SCREENSHOT_READ_FAILED"
              : "ASSISTANT_RUN_FAILED",
        });
        await deps.runs
          .finish(
            run.actorId,
            run.id,
            run.leaseToken,
            cancelled ? "cancelled" : "failed",
          )
          .catch(() => {});
      } finally {
        clearInterval(heartbeat);
        active.delete(run.id);
      }
    } finally {
      busy = false;
    }
  }
  return {
    tick,
    start() {
      stopped = false;
      timer = setInterval(() => {
        void tick().catch(() => {});
      }, 1000);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      for (const c of active.values()) c.abort();
    },
    cancel(id: string) {
      active.get(id)?.abort();
    },
  };
}
