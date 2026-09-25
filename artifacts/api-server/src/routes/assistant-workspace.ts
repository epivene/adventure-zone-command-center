import { publicCampaignReviews } from "../features/assistant-workspace/campaign-tools";
import { confirmationFor } from "../features/assistant-workspace/commercial-actions";
import { publicDocumentResults } from "../features/assistant-workspace/document-results";
import { randomUUID } from "node:crypto";
import {
  Router,
  raw,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  messageInput,
  actionInput,
} from "../features/assistant-workspace/http-schema";
import {
  getWorkspaceRuntime,
  type WorkspaceRuntime,
} from "../features/assistant-workspace/runtime";
import { readModelConfig } from "../features/assistant-workspace/model-config";
import { selectionSchema } from "../features/assistant-workspace/contracts";
import { pool } from "@workspace/db";
import { readWorkspaceReadiness } from "../features/assistant-workspace/readiness";
import {
  workspaceStartup,
  type WorkspaceStartupState,
} from "../features/assistant-workspace/startup";
import { PostgresGoogleConnectionRepository } from "../features/google-workspace/google-connection-repository";
import { MAX_SCREENSHOT_BYTES } from "../features/assistant-workspace/screenshots";
const uuid = (value: unknown) => z.string().uuid().parse(value);
export function createAssistantWorkspaceRouter(
  runtime: () => WorkspaceRuntime = getWorkspaceRuntime,
  options: {
    startup?: () => WorkspaceStartupState;
    readiness?: (actorId: string) => ReturnType<typeof readWorkspaceReadiness>;
  } = {},
) {
  const router = Router();
  router.use(requireOwnerMiddleware);
  const windows = new Map<string, { start: number; count: number }>();
  const startup = options.startup ?? workspaceStartup.state;
  const readiness =
    options.readiness ??
    ((actorId: string) =>
      readWorkspaceReadiness({
        env: process.env,
        actorId,
        db: pool,
        startup: startup(),
        google: new PostgresGoogleConnectionRepository(),
      }));
  router.get("/status", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    void readiness((req as Request & { userId: string }).userId || "owner")
      .then((status) => res.json(status))
      .catch(next);
  });
  router.use((req, res, next) => {
    const config = readModelConfig(process.env);
    const actor = (req as Request & { userId: string }).userId || "owner";
    if (!config.enabled) {
      res.status(503).json({ code: config.error ?? "ASSISTANT_DISABLED" });
      return;
    }
    if (!config.allowedActorIds.includes(actor)) {
      res.status(403).json({ code: "ASSISTANT_ACCESS_DENIED" });
      return;
    }
    if (startup() !== "ready") {
      res.status(503).json({ code: "ASSISTANT_STARTUP_REQUIRED" });
      return;
    }
    res.locals.actorId = actor;
    if (req.method !== "GET") {
      const now = Date.now();
      let w = windows.get(actor);
      if (!w || now - w.start > 60000) {
        w = { start: now, count: 0 };
        windows.set(actor, w);
      }
      if (++w.count > 30) {
        res.status(429).json({ code: "ASSISTANT_RATE_LIMIT" });
        return;
      }
    }
    next();
  });
  const wrap =
    (
      fn: (
        req: Request,
        res: Response,
        r: WorkspaceRuntime,
        actor: string,
      ) => Promise<unknown>,
    ) =>
    (req: Request, res: Response, next: NextFunction) => {
      void fn(req, res, runtime(), res.locals.actorId).catch(next);
    };
  router.get(
    "/conversations",
    wrap(async (_q, s, r, a) => s.json(await r.conversations.list(a))),
  );
  router.post(
    "/conversations",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({ title: z.string().max(160) })
        .strict()
        .parse(q.body);
      s.status(201).json(await r.conversations.create(a, input.title));
    }),
  );
  router.get(
    "/conversations/:id",
    wrap(async (q, s, r, a) => {
      const id = uuid(q.params.id);
      const conversation = await r.conversations.get(a, id);
      if (!conversation) {
        s.status(404).json({ code: "ASSISTANT_CONVERSATION_NOT_FOUND" });
        return;
      }
      const [actions, drafts, runs] = await Promise.all([
        r.actions.list(a, id),
        r.drafts.list(a, id),
        r.runs.list(a, id),
      ]);
      s.json({
        ...conversation,
        actions: await Promise.all(
          actions.map(async (action) => ({
            ...action,
            preview:
              action.status === "prepared" && r.actionPreview
                ? await r.actionPreview(
                    {
                      actor: { id: a, role: "owner", connectionId: null },
                      conversationId: id,
                      runId: "review",
                      selection: conversation.selection,
                      grants: [],
                      signal: new AbortController().signal,
                    },
                    action,
                  )
                : null,
          })),
        ),
        drafts,
        campaignReviews: publicCampaignReviews(runs),
        campaigns: r.campaigns
          ? await r.campaigns.list(a, conversation.id)
          : [],
        selectedModel:
          runs.find((run) => run.input?.model)?.input?.model ?? r.config.model,
        documentResults: publicDocumentResults(runs),
        runs: runs.map((run) => ({
          id: run.id,
          status: run.status,
          usage: { steps: run.turn?.steps ?? 0, tokens: run.turn?.tokens ?? 0 },
          result: run.turn?.final ?? null,
        })),
      });
    }),
  );
  router.patch(
    "/conversations/:id/selection",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          version: z.number().int().positive(),
          selection: selectionSchema,
        })
        .strict()
        .parse(q.body);
      s.json(
        await r.conversations.setSelection(
          a,
          uuid(q.params.id),
          input.version,
          input.selection,
        ),
      );
    }),
  );
  router.post(
    "/conversations/:id/messages",
    wrap(async (q, s, r, a) => {
      const input = messageInput.parse(q.body),
        id = uuid(q.params.id);
      const c = await r.conversations.get(a, id);
      if (!c) {
        s.status(404).json({ code: "ASSISTANT_CONVERSATION_NOT_FOUND" });
        return;
      }
      if (input.model && !r.config.models.includes(input.model)) {
        s.status(422).json({ code: "ASSISTANT_MODEL_UNAVAILABLE" });
        return;
      }
      const attachments = input.attachmentIds.length
        ? await r.screenshots.metadataForSend(a, id, input.attachmentIds)
        : [];
      let connectionId: string | null = null;
      try {
        connectionId = (await r.google.getCurrent())?.id ?? null;
      } catch {
        /* Chat remains usable; Gmail tools report disconnection. */
      }
      const run = await r.runs.submit(
        {
          actor: { id: a, role: "owner", connectionId },
          conversationId: id,
          requestKey: input.requestKey,
          selection: c.selection,
          grants: [],
          model: input.model ?? r.config.model,
        },
        input.text,
        attachments,
      );
      s.status(202).json({ runId: run.id, status: run.status });
      void r.worker.tick().catch(() => {});
    }),
  );
  router.put(
    "/conversations/:id/screenshots/:screenshotId",
    raw({
      type: ["image/png", "image/jpeg", "image/webp"],
      limit: MAX_SCREENSHOT_BYTES,
      inflate: false,
    }),
    wrap(async (q, s, r, a) => {
      if (!Buffer.isBuffer(q.body))
        throw new Error("ASSISTANT_SCREENSHOT_INVALID");
      let filename: string;
      try {
        filename = decodeURIComponent(q.get("X-File-Name") ?? "Screenshot");
      } catch {
        throw new Error("ASSISTANT_SCREENSHOT_INVALID");
      }
      s.status(201).json(
        await r.screenshots.upload(
          a,
          uuid(q.params.id),
          uuid(q.params.screenshotId),
          filename,
          q.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "",
          q.body,
        ),
      );
    }),
  );
  router.get(
    "/conversations/:id/screenshots/:screenshotId",
    wrap(async (q, s, r, a) => {
      const file = await r.screenshots.read(
        a,
        uuid(q.params.id),
        uuid(q.params.screenshotId),
      );
      s.set({
        "Content-Type": file.attachment.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      }).send(Buffer.from(file.bytes));
    }),
  );
  router.get(
    "/runs/:id",
    wrap(async (q, s, r, a) => {
      const run = await r.runs.get(a, uuid(q.params.id));
      if (!run) {
        s.status(404).json({ code: "ASSISTANT_RUN_NOT_FOUND" });
        return;
      }
      s.json({
        id: run.id,
        status: run.status,
        result: run.turn?.final ?? null,
        usage: { steps: run.turn?.steps ?? 0, tokens: run.turn?.tokens ?? 0 },
      });
    }),
  );
  router.get(
    "/runs/:id/events",
    wrap(async (q, s, r, a) => {
      const id = uuid(q.params.id);
      if (!(await r.runs.get(a, id))) {
        s.status(404).json({ code: "ASSISTANT_RUN_NOT_FOUND" });
        return;
      }
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .parse(q.query.after ?? 0);
      const events = await r.runs.events(a, id, after);
      if (q.headers.accept?.includes("text/event-stream")) {
        s.setHeader("Content-Type", "text/event-stream");
        s.setHeader("Cache-Control", "no-cache");
        for (const e of events)
          s.write(
            `id: ${e.sequence}\nevent: ${e.kind}\ndata: ${JSON.stringify(e.payload)}\n\n`,
          );
        s.end();
        return;
      }
      s.json(events);
    }),
  );
  router.post(
    "/runs/:id/cancel",
    wrap(async (q, s, r, a) => {
      const id = uuid(q.params.id);
      if (!(await r.runs.get(a, id))) {
        s.status(404).json({ code: "ASSISTANT_RUN_NOT_FOUND" });
        return;
      }
      await r.runs.cancel(a, id);
      r.worker.cancel(id);
      s.json({ status: "cancelling" });
    }),
  );
  router.post(
    "/actions/:id/execute",
    wrap(async (q, s, r, a) => {
      const input = actionInput.parse(q.body);
      const action = await r.actions.get(a, uuid(q.params.id));
      if (!action) {
        s.status(404).json({ code: "ASSISTANT_ACTION_NOT_FOUND" });
        return;
      }
      const confirmation = confirmationFor(action.kind);
      if (
        confirmation &&
        input.confirmation !== confirmation &&
        action.status === "prepared"
      ) {
        s.status(422).json({ code: "ASSISTANT_HUMAN_VERIFICATION_REQUIRED" });
        return;
      }
      if (input.revision !== action.expectedRevision) {
        s.status(409).json({ code: "ASSISTANT_VERSION_CONFLICT" });
        return;
      }
      const c = await r.conversations.get(a, action.conversationId);
      if (!c) {
        s.status(404).json({ code: "ASSISTANT_CONVERSATION_NOT_FOUND" });
        return;
      }
      await r.conversations.append(a, c.id, `approve:${input.requestKey}`, {
        role: "user",
        text: `Approve ${action.kind} on ${action.targetId}, revision ${input.revision ?? "new"}, action ${action.id}.${input.confirmation ? ` Human verification: ${input.confirmation}.` : ""}`,
      });
      const connectionId = action.connectionId
        ? ((await r.google.getCurrent())?.id ?? null)
        : null;
      const output = await r.executor.execute(
        {
          actor: { id: a, role: "owner", connectionId },
          conversationId: c.id,
          runId: `ui:${input.requestKey}`,
          selection: c.selection,
          grants: [
            {
              actorId: a,
              sourceMessageId: action.sourceMessageId,
              actionKind: action.kind,
              targetIds: [action.targetId],
              revision: action.expectedRevision,
              connectionId: action.connectionId,
            },
          ],
          signal: new AbortController().signal,
        },
        action,
      );
      s.json(output);
    }),
  );
  router.post(
    "/drafts/:id/send-review",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          revision: z.string(),
          paymentModel: z.enum(["prepaid", "pay_per_play", "administrative"]),
        })
        .strict()
        .parse(q.body);
      s.json(
        await r.send.review(
          a,
          uuid(q.params.id),
          input.revision,
          input.paymentModel,
        ),
      );
    }),
  );
  router.post(
    "/drafts/:id/send-approval",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          revision: z.string(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          intent: z.enum(["exploratory", "administrative", "specific_offer"]),
          holdId: z.string().uuid().nullable(),
          stage: z.enum(["initial", "follow_up_1", "follow_up_2"]).nullable(),
          reason: z.string().min(1).max(2000),
          evidenceReviewed: z.literal(true),
        })
        .strict()
        .parse(q.body);
      const { revision, ...approval } = input;
      s.json(await r.send.approve(a, uuid(q.params.id), revision, approval));
    }),
  );
  router.post(
    "/drafts/:id/send",
    wrap(async (q, s, r, a) => {
      const input = actionInput.parse(q.body);
      const draft = await r.drafts.get(a, uuid(q.params.id));
      if (!draft) {
        s.status(404).json({ code: "ASSISTANT_DRAFT_NOT_FOUND" });
        return;
      }
      if (input.revision !== draft.revision) {
        s.status(409).json({ code: "ASSISTANT_DRAFT_VERSION_CONFLICT" });
        return;
      }
      const c = await r.conversations.get(a, draft.conversationId);
      if (!c) {
        s.status(404).json({ code: "ASSISTANT_CONVERSATION_NOT_FOUND" });
        return;
      }
      const connectionId = (await r.google.getCurrent())?.id ?? null;
      if (!connectionId) {
        s.status(503).json({ code: "ASSISTANT_GOOGLE_DISCONNECTED" });
        return;
      }
      const source = await r.conversations.append(
        a,
        c.id,
        `send:${input.requestKey}`,
        {
          role: "user",
          text: `Send the approved email draft ${draft.id}, revision ${draft.revision}.`,
        },
      );
      const intent = {
        id: randomUUID(),
        actorId: a,
        conversationId: c.id,
        kind: "send_draft",
        targetId: draft.id,
        expectedRevision: draft.revision,
        connectionId,
        arguments: { draftId: draft.id, revision: draft.revision },
        sourceMessageId: source.id,
      };
      const result = await r.executor.execute(
        {
          actor: { id: a, role: "owner", connectionId },
          conversationId: c.id,
          runId: `ui:${input.requestKey}`,
          selection: c.selection,
          grants: [
            {
              actorId: a,
              sourceMessageId: source.id,
              actionKind: intent.kind,
              targetIds: [draft.id],
              revision: draft.revision,
              connectionId,
            },
          ],
          signal: new AbortController().signal,
        },
        intent,
      );
      s.json(result);
    }),
  );
  router.post(
    "/drafts/:id/save-gmail",
    wrap(async (q, s, r, a) => {
      const input = actionInput.parse(q.body);
      const draft = await r.drafts.get(a, uuid(q.params.id));
      if (!draft) {
        s.status(404).json({ code: "ASSISTANT_DRAFT_NOT_FOUND" });
        return;
      }
      if (input.revision !== draft.revision) {
        s.status(409).json({ code: "ASSISTANT_DRAFT_VERSION_CONFLICT" });
        return;
      }
      const c = await r.conversations.get(a, draft.conversationId);
      if (!c) {
        s.status(404).json({ code: "ASSISTANT_CONVERSATION_NOT_FOUND" });
        return;
      }
      const connectionId = (await r.google.getCurrent())?.id ?? null;
      if (!connectionId) {
        s.status(503).json({ code: "ASSISTANT_GOOGLE_DISCONNECTED" });
        return;
      }
      const source = await r.conversations.append(
        a,
        c.id,
        `save:${input.requestKey}`,
        {
          role: "user",
          text: `Save draft ${draft.id}, revision ${draft.revision}, in Gmail.`,
        },
      );
      const intent = {
        id: randomUUID(),
        actorId: a,
        conversationId: c.id,
        kind: "save_gmail_draft",
        targetId: draft.id,
        expectedRevision: draft.revision,
        connectionId,
        arguments: { draftId: draft.id, revision: draft.revision },
        sourceMessageId: source.id,
      };
      const result = await r.executor.execute(
        {
          actor: { id: a, role: "owner", connectionId },
          conversationId: c.id,
          runId: `ui:${input.requestKey}`,
          selection: c.selection,
          grants: [
            {
              actorId: a,
              sourceMessageId: source.id,
              actionKind: intent.kind,
              targetIds: [draft.id],
              revision: draft.revision,
              connectionId,
            },
          ],
          signal: new AbortController().signal,
        },
        intent,
      );
      s.json(result);
    }),
  );
  router.patch(
    "/drafts/:id",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({
          revision: z.string(),
          subject: z.string().min(1).max(300),
          html: z.string().min(1).max(150000),
          text: z.string().min(1).max(30000),
        })
        .strict()
        .parse(q.body);
      s.json(
        await r.drafts.edit(a, uuid(q.params.id), input.revision, {
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      );
    }),
  );
  router.get(
    "/knowledge",
    wrap(async (_q, s, r) => s.json(await r.knowledge.history())),
  );
  router.post(
    "/knowledge",
    wrap(async (q, s, r, a) =>
      s.status(201).json(await r.knowledge.propose(a, q.body)),
    ),
  );
  router.post(
    "/knowledge/:id/approve",
    wrap(async (q, s, r, a) => {
      const input = z
        .object({ expectedVersion: z.number().int().min(0) })
        .strict()
        .parse(q.body);
      s.json(
        await r.knowledge.approve(a, uuid(q.params.id), input.expectedVersion),
      );
    }),
  );
  router.use(
    (error: unknown, _q: Request, s: Response, _next: NextFunction) => {
      const code =
        error instanceof Error ? error.message : "ASSISTANT_REQUEST_FAILED";
      if (
        (error as any)?.type === "entity.too.large" ||
        code === "ASSISTANT_SCREENSHOT_SIZE_INVALID"
      ) {
        s.status(413).json({ code: "ASSISTANT_SCREENSHOT_SIZE_INVALID" });
        return;
      }
      if (
        code === "ASSISTANT_SCREENSHOT_INVALID" ||
        (error as any)?.type === "encoding.unsupported"
      ) {
        s.status(422).json({ code: "ASSISTANT_SCREENSHOT_INVALID" });
        return;
      }
      if (error instanceof z.ZodError) {
        s.status(422).json({ code: "ASSISTANT_INPUT_INVALID" });
        return;
      }
      if (
        (error as any)?.code === "23505" ||
        /CONFLICT|CHANGED|BUSY/.test(code)
      ) {
        s.status(409).json({ code: "ASSISTANT_STATE_CHANGED" });
        return;
      }
      s.status(/NOT_FOUND/.test(code) ? 404 : 503).json({
        code: code.startsWith("ASSISTANT_")
          ? code
          : "ASSISTANT_REQUEST_UNAVAILABLE",
      });
    },
  );
  return router;
}
export default createAssistantWorkspaceRouter();
