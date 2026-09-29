import { loadProfileBrief } from "./profile-brief";
import { submitScopedMessage } from "./scoped-submit";
import type { RunInput } from "./run-store";
import type { Screenshot } from "./contracts";
import { loadTaskChangeProof } from "./profile-task-evidence";
import { guardTaskMutation } from "./profile-task-safety";
import { profileTaskView } from "./profile-task-view";
import {
  createProfileTaskTools,
  profileTaskSavedContext,
} from "./profile-task-tools";
import { ProfileTaskRunner } from "./profile-task-runner";
import { grantTaskAction } from "./profile-task-policy";
import { ProfileTaskStore } from "./profile-task-store";
import { CampaignStore } from "./campaign-store";
import { ScreenshotStore } from "./screenshots";
import { createScreenshotTools } from "./screenshot-tools";
import { createHistoryTools } from "./history-tools";
import { createCampaignTools } from "./campaign-tools";
import { campaignAdapters, campaignActionPreview } from "./campaign-actions";
import { createOperationsTools } from "./operations-tools";
import {
  operationsAdapters,
  operationsActionPreview,
} from "./operations-actions";
import {
  commercialAdapters,
  commercialActionPreview,
} from "./commercial-adapters";
import type { ActionIntent, RunContext } from "./contracts";
import { createCommercialTools } from "./commercial-tools";
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
import { SpendingStore } from "./spending-store";
import { SavedResearchCache } from "./research-cache";
export function createWorkspaceRuntime() {
  const config = readModelConfig(process.env);
  const spending = new SpendingStore(db, pool);
  const researchCache = new SavedResearchCache(pool);
  const ownerId = "owner";
  const profileTasks = new ProfileTaskStore(pool);
  const profileTaskRunner = new ProfileTaskRunner(
    pool,
    profileTasks,
    config.model,
    config.allowedActorIds,
  );
  const conversations = new ConversationStore(pool),
    runs = new RunStore(pool),
    actions = new ActionStore(pool),
    drafts = new DraftStore(pool),
    knowledge = new KnowledgeRepository(pool),
    google = new PostgresGoogleConnectionRepository();
  const campaigns = new CampaignStore(db, pool);
  const screenshots = new ScreenshotStore(pool);
  const readScreenshot = screenshots.readForModel.bind(screenshots);
  const reads = productionReads(pool, ownerId, google, spending);
  const send = createWorkspaceSendService({
    pool,
    db,
    drafts,
    conversations,
    google,
  });
  const executor = new ActionExecutor(
    ownerId,
    actions,
    {
      ...campaignAdapters(db, pool),
      ...operationsAdapters(db, pool),
      ...productionRecordAdapters(db, pool),
      ...commercialAdapters(db, pool),
      ...externalAdapters(pool, google),
      save_gmail_draft: gmailDraftAdapter(drafts, google),
      send_draft: send.adapter,
    },
    async (context, intent) => {
      if (
        process.env.ASSISTANT_PROFILE_TASKS_ENABLED !== "true" ||
        !context.taskId
      )
        return null;
      const task = await profileTasks.get(context.actor.id, context.taskId);
      const item = task?.items.find((i) => i.profileId === intent.targetId);
      if (item)
        await pool.query(
          `UPDATE assistant_profile_task_items SET action_ids=CASE WHEN action_ids @> $2::jsonb THEN action_ids ELSE action_ids || $2::jsonb END WHERE id=$1`,
          [item.id, JSON.stringify([intent.id])],
        );
      const row = (
        await pool.query(
          "SELECT * FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
          [intent.targetId],
        )
      ).rows[0];
      return task && item && row
        ? grantTaskAction(
            task,
            item,
            intent,
            new Date(row.updated_at).toISOString(),
            {
              ...row,
              address1: row.address_1,
              address2: row.address_2,
              postalCode: row.postal_code,
            },
            await loadTaskChangeProof(pool, task, intent),
          )
        : null;
    },
    (context, intent) =>
      guardTaskMutation(
        pool,
        context,
        intent,
        process.env.ASSISTANT_PROFILE_TASKS_ENABLED === "true",
      ),
  );
  const validateTaskProfiles = async (ids: string[]) => {
    const found = await pool.query(
      "SELECT id FROM organizations WHERE id=ANY($1::uuid[]) AND consolidated_into_id IS NULL",
      [ids],
    );
    if (found.rows.length !== ids.length)
      throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
  };
  const campaignTools = createCampaignTools({
    ownerId,
    database: db,
    db: pool,
    campaigns,
    conversations,
    runs,
    executor,
    config,
    spending,
    researchCache,
  });
  const tools = createToolRegistry([
    createProfileTaskTools(
      pool,
      profileTasks,
      validateTaskProfiles,
      () => process.env.ASSISTANT_PROFILE_TASKS_ENABLED === "true",
      (context, call) => campaignTools.execute(context, call),
    ),
    createScreenshotTools({ ownerId, screenshots, runs }),
    createHistoryTools({ ownerId, conversations, runs }),
    campaignTools,
    createOperationsTools({ ownerId, database: db, db: pool, runs, executor }),
    createReadTools({ ownerId, ...reads }),
    createCommercialTools({
      ownerId,
      db: pool,
      reader: reads.reader,
      executor,
      runs,
    }),
    createWorkspaceTools({
      campaigns,
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
    taskContext: (context) =>
      profileTaskSavedContext(pool, context, profileTasks),
    profileTasks: {
      enabled: () => process.env.ASSISTANT_PROFILE_TASKS_ENABLED === "true",
      dispatchNextTaskBatch:
        profileTaskRunner.dispatchNextTaskBatch.bind(profileTaskRunner),
      reconcileTaskRun:
        profileTaskRunner.reconcileTaskRun.bind(profileTaskRunner),
      check: profileTaskRunner.check.bind(profileTaskRunner),
    },
    runs,
    conversations,
    model: createOpenAiModel(config, undefined, readScreenshot, spending),
    modelFor: (model) => {
      if (model && !config.models.includes(model))
        throw new Error("ASSISTANT_MODEL_UNAVAILABLE");
      return createOpenAiModel(
        { ...config, model: model ?? config.model },
        undefined,
        readScreenshot,
        spending,
      );
    },
    tools,
    allowedActorIds: config.allowedActorIds,
    maxSteps: config.maxSteps,
    maxTokens: config.maxRunTokens,
    profileBrief: (context) => loadProfileBrief(pool, context),
    historicalEvidence: (context) => researchCache.listIndex(context),
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
    profileTasks,
    taskView: (task: import("./profile-task-contracts").Task) =>
      profileTaskView(pool, task),
    validateTaskProfiles,
    spending,
    researchCache,
    screenshots,
    actionPreview: async (context: RunContext, intent: ActionIntent) => {
      try {
        return (
          (await campaignActionPreview(pool, context, intent)) ??
          (await operationsActionPreview(pool, context, intent)) ??
          (await commercialActionPreview(pool, context, intent))
        );
      } catch {
        return {
          available: false,
          title: "Action needs refreshed information",
          summary:
            "The reviewed record or selected scope changed. Ask the assistant to refresh this action.",
          revision: intent.expectedRevision,
          reviewHref: null,
        };
      }
    },
    submitScoped: async (input: Omit<RunInput, "sourceMessageId">, text: string, attachments: Screenshot[]) => {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const run = await submitScopedMessage(connection, input, text, attachments);
        await connection.query("COMMIT");
        return run;
      } catch (error) {
        await connection.query("ROLLBACK"); throw error;
      } finally { connection.release(); }
    },
    campaigns,
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
