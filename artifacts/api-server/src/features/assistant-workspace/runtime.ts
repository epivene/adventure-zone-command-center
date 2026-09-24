import { createWorkspaceSendService } from "./gmail-send";
import { externalAdapters } from "./external-actions";
import { gmailDraftAdapter } from "./gmail-drafts";
import { db, pool } from "@workspace/db";
import { readModelConfig } from "./model-config";
import { createOpenAiModel } from "./openai-model";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { ActionStore } from "./action-store";
import { DraftStore } from "./draft-store";
import { KnowledgeRepository } from "./knowledge";
import { PostgresGoogleConnectionRepository } from "../google-workspace/google-connection-repository";
import { productionReads } from "./production-reads";
import { productionRecordAdapters } from "./production-records";
import { ActionExecutor } from "./action-executor";
import { createReadTools } from "./read-tools";
import { createToolRegistry } from "./tool-registry";
import { createWorkspaceTools } from "./workspace-tools";
import { createWorkspaceWorker } from "./worker";
export function createWorkspaceRuntime() {
  const config = readModelConfig(process.env);
  const ownerId = "owner";
  const conversations = new ConversationStore(pool),
    runs = new RunStore(pool),
    actions = new ActionStore(pool),
    drafts = new DraftStore(pool),
    knowledge = new KnowledgeRepository(pool),
    google = new PostgresGoogleConnectionRepository();
  const reads = productionReads(pool, ownerId, google);
  const send = createWorkspaceSendService({
    pool,
    db,
    drafts,
    conversations,
    google,
  });
  const executor = new ActionExecutor(ownerId, actions, {
    ...productionRecordAdapters(db, pool),
    ...externalAdapters(pool, google),
    save_gmail_draft: gmailDraftAdapter(drafts, google),
    send_draft: send.adapter,
  });
  const tools = createToolRegistry([
    createReadTools({ ownerId, ...reads }),
    createWorkspaceTools({
      ownerId,
      db: pool,
      conversations,
      runs,
      drafts,
      reader: reads.reader,
      executor,
      connectionFor: async (kind) =>
        kind.includes("calendar_event")
          ? ((await google.getByRole("operational_calendar"))?.id ?? null)
          : ((await google.getCurrent())?.id ?? null),
    }),
  ]);
  const worker = createWorkspaceWorker({
    runs,
    conversations,
    model: createOpenAiModel(config),
    modelFor: (model) => {
      if (model && !config.models.includes(model))
        throw new Error("ASSISTANT_MODEL_UNAVAILABLE");
      return createOpenAiModel({ ...config, model: model ?? config.model });
    },
    tools,
    allowedActorIds: config.allowedActorIds,
    maxSteps: config.maxSteps,
    maxTokens: config.maxRunTokens,
    evidence: async (organizationId, eventYear) =>
      (
        await knowledge.list({
          organizationId,
          eventYear,
          at: new Date().toISOString().slice(0, 10),
        })
      ).map((rule) => ({
        id: rule.id,
        kind: "rule",
        recordId: rule.ruleKey,
        eventYear: rule.eventYear,
        occurredAt: null,
        retrievedAt: new Date().toISOString(),
        version: String(rule.version),
        complete: true,
        text: JSON.stringify(rule),
      })),
  });
  return {
    config,
    ownerId,
    conversations,
    runs,
    actions,
    drafts,
    knowledge,
    google,
    executor,
    worker,
    send,
  };
}
export type WorkspaceRuntime = ReturnType<typeof createWorkspaceRuntime>;
let instance: WorkspaceRuntime | undefined;
export function getWorkspaceRuntime() {
  return (instance ??= createWorkspaceRuntime());
}
export function startWorkspaceRuntime() {
  const r = getWorkspaceRuntime();
  if (r.config.enabled) r.worker.start();
  return () => r.worker.stop();
}
