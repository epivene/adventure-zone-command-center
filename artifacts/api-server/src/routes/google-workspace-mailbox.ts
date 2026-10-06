import { Router } from "express";
import { z } from "zod";
import { requireOwnerMiddleware } from "../lib/auth";
import { GoogleMailboxService } from "@/features/google-workspace/google-mailbox-service";

const id = z.string().regex(/^[A-Za-z0-9_-]+$/).max(250);
const accountId = z.string().uuid();
const account = z.object({ connectionId: accountId });
const page = z.object({
  folder: z.enum(["inbox", "sent", "drafts", "search"]).default("inbox"),
  query: z.string().max(1000).default(""), pageToken: z.string().max(2000).optional(),
  connectionId: accountId.optional(),
});
function errorStatus(code: string) {
  if (/NOT_CONNECTED|REAUTHORIZATION|CONNECTION_CHANGED|CONFLICT|DRAFT_CHANGED|OUTCOME_UNCERTAIN/.test(code)) return 409;
  if (/SOURCE_NOT_FOUND|TARGET_NOT_FOUND/.test(code)) return 404;
  return 503;
}

export function createGoogleMailboxRouter(service = new GoogleMailboxService()) {
  const router = Router();
  router.use("/google-workspace/mailbox", requireOwnerMiddleware);
  function handle(schema: z.ZodTypeAny, run: (data: any, req: any, res: any) => Promise<void>, query = false) {
    return async (req: any, res: any) => {
      const parsed = schema.safeParse(query ? req.query : req.body);
      if (!parsed.success) { res.status(400).json({ error: "GOOGLE_WORKSPACE_MAILBOX_REQUEST_INVALID" }); return; }
      try { await run(parsed.data, req, res); }
      catch (error) {
        const code = error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")
          ? error.message : "GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE";
        res.status(errorStatus(code)).json({ error: code });
      }
    };
  }
  const thread = (req: any) => id.parse(req.params.threadId);
  const draft = (req: any) => id.parse(req.params.draftId);
  router.get("/google-workspace/mailbox", handle(page, async (data, _req, res) => { res.json(await service.list(data)); }, true));
  router.get("/google-workspace/mailbox/profiles", handle(z.object({ query: z.string().max(200).default("") }), async (data, _req, res) => { res.json(await service.profiles(data.query)); }, true));
  router.get("/google-workspace/mailbox/threads/:threadId", handle(account, async (data, req, res) => { res.json(await service.thread(thread(req), data.connectionId)); }, true));
  router.get("/google-workspace/mailbox/threads/:threadId/attachments/:messageId/:attachmentId",
    handle(account, async (data, req, res) => {
      const file = await service.attachment({ ...data, threadId: thread(req), messageId: id.parse(req.params.messageId), attachmentId: id.parse(req.params.attachmentId) });
      const filename = file.filename.replace(/[\r\n"\\]/g, "_");
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.set("X-Content-Type-Options", "nosniff");
      res.send(Buffer.from(file.bytes));
    }, true));
  router.post("/google-workspace/mailbox/threads/:threadId/link", handle(account.extend({ messageId: id, organizationId: z.string().uuid(), expectedOrganizationId: z.string().uuid().optional() }).strict(), async (data, req, res) => {
    res.json(await service.link({ ...data, threadId: thread(req), actorId: req.userId || "owner" }));
  }));
  router.post("/google-workspace/mailbox/threads/:threadId/archive", handle(account.strict(), async (data, req, res) => { res.json(await service.archive(thread(req), data.connectionId)); }));
  router.post("/google-workspace/mailbox/threads/:threadId/read", handle(account.extend({ read: z.boolean() }).strict(), async (data, req, res) => { res.json(await service.markRead(thread(req), data.connectionId, data.read)); }));
  router.post("/google-workspace/mailbox/drafts", handle(account.extend({
    to: z.string().email().max(320), subject: z.string().trim().min(1).max(998),
    body: z.string().min(1).max(100000), bodyFormat: z.enum(["plain_text", "html"]).optional(), threadId: id.optional(),
  }).strict(), async (data, _req, res) => { res.json(await service.createDraft(data)); }));
  router.get("/google-workspace/mailbox/drafts/:draftId", handle(account, async (data, req, res) => { res.json(await service.draft(draft(req), data.connectionId)); }, true));
  router.post("/google-workspace/mailbox/drafts/:draftId/send", handle(account.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict(), async (data, req, res) => { res.json(await service.sendDraft({ ...data, draftId: draft(req) })); }));
  return router;
}
export default createGoogleMailboxRouter();
