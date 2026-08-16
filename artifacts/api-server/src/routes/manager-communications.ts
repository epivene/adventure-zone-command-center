import express, { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { CommunicationRepository, type MessageActor } from "@/features/manager-comms/communication-repository";
import { CommunicationParticipantRepository } from "@/features/manager-comms/communication-participant-repository";
import { NotificationRepository } from "@/features/manager-comms/notification-repository";
import { createConversationForActor, sendMessageForActor } from "@/features/manager-comms/communication-service";
import { attachFilesToMessages } from "@/features/manager-comms/message-view";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const communication = new CommunicationRepository(db);
const participants = new CommunicationParticipantRepository(db);
const notifications = new NotificationRepository(db);
const storage = new GoogleCloudLegManagerObjectStorage();
const serviceStore = {
  createConversation: (input: any) => communication.createConversation(input),
  sendMessage: (input: any) => communication.sendMessage(input),
  listMemberLegIds: (conversationId: string) => participants.listMemberLegIds(conversationId),
};

function actor(req: any): MessageActor {
  return { kind: "manager", legId: req.legManager.legId, name: req.legManager.managerName ?? null };
}
function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function routeError(res: any, error: unknown) {
  const code = (error as any)?.code;
  if (code === "FORBIDDEN") return res.status(403).json({ error: (error as Error).message });
  if (code === "NOT_FOUND") return res.status(404).json({ error: (error as Error).message });
  throw error;
}

const conversationInput = z.object({
  kind: z.enum(["direct", "group"]),
  title: z.string().trim().max(160).nullable().optional(),
  memberLegIds: z.array(z.string().uuid()).max(12),
});
const messageInput = z.object({
  body: z.string().trim().min(1).max(12000),
  clientMutationId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional().default([]),
});
const attachmentInput = z.object({
  id: z.string().uuid(),
  fileName: z.string().trim().max(240).nullable().optional(),
  mimeType: z.string().trim().max(160).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().max(12 * 1024 * 1024).nullable().optional(),
  clientMutationId: z.string().uuid(),
});

router.get("/manager/messages/conversations", requireManager, async (req, res) => {
  await communication.ensureSchema();
  await participants.ensureDefaultConversations(req.legManager!.legId, req.legManager!.managerName);
  res.json({ conversations: await communication.listForManager(req.legManager!.legId) });
});

router.post("/manager/messages/conversations", requireManager, async (req, res): Promise<void> => {
  const parsed = conversationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid conversation" }); return; }
  try {
    const conversation = await createConversationForActor(serviceStore, actor(req), {
      kind: parsed.data.kind,
      title: parsed.data.title ?? null,
      memberLegIds: parsed.data.memberLegIds,
    });
    res.status(201).json({ conversation });
  } catch (error) { routeError(res, error); }
});

router.get("/manager/messages/conversations/:conversationId", requireManager, async (req, res): Promise<void> => {
  const conversationId = param(req.params.conversationId);
  try {
    const messages = await communication.getMessages(conversationId, actor(req));
    const attachments = await participants.listAttachmentsForMessages(messages.map((message) => message.id));
    await communication.markConversationRead(conversationId, req.legManager!.legId);
    res.json({ messages: await attachFilesToMessages(messages, attachments, storage) });
  } catch (error) { routeError(res, error); }
});

router.post("/manager/messages/conversations/:conversationId", requireManager, async (req, res): Promise<void> => {
  const conversationId = param(req.params.conversationId);
  const parsed = messageInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid message" }); return; }
  try {
    const message = await sendMessageForActor(serviceStore, notifications, actor(req), {
      conversationId,
      body: parsed.data.body,
      clientMutationId: parsed.data.clientMutationId,
    });
    for (const attachmentId of parsed.data.attachmentIds) {
      const attachment = await communication.getAttachment(attachmentId);
      if (!attachment || attachment.conversationId !== conversationId || attachment.uploaderLegId !== req.legManager!.legId) continue;
      await communication.attachFileToMessage(attachmentId, message.id);
    }
    res.status(201).json({ message });
  } catch (error) { routeError(res, error); }
});

router.post("/manager/messages/conversations/:conversationId/attachments", requireManager, async (req, res): Promise<void> => {
  const conversationId = param(req.params.conversationId);
  const parsed = attachmentInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid attachment" }); return; }
  try {
    const attachment = await communication.createAttachment({
      id: parsed.data.id,
      conversationId,
      actor: actor(req),
      fileName: parsed.data.fileName ?? null,
      mimeType: parsed.data.mimeType ?? null,
      sizeBytes: parsed.data.sizeBytes ?? null,
      clientMutationId: parsed.data.clientMutationId,
    });
    res.status(201).json({ attachment });
  } catch (error) { routeError(res, error); }
});

router.put(
  "/manager/messages/attachments/:attachmentId/file",
  requireManager,
  express.raw({ type: () => true, limit: "12mb" }),
  async (req, res): Promise<void> => {
    const attachmentId = param(req.params.attachmentId);
    const attachment = await communication.getAttachment(attachmentId);
    if (!attachment || attachment.uploaderLegId !== req.legManager!.legId || !(await participants.canManagerViewConversation(attachment.conversationId, req.legManager!.legId))) {
      res.status(403).json({ error: "Attachment is outside your access" }); return;
    }
    const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
    if (!bytes.length) { res.status(400).json({ error: "File is required" }); return; }
    const rawType = req.headers["content-type"];
    const mimeType = Array.isArray(rawType) ? rawType[0] ?? "application/octet-stream" : rawType ?? "application/octet-stream";
    const key = `manager-messages/${attachment.conversationId}/${attachment.id}`;
    await storage.put(key, bytes, mimeType);
    res.json({ attachment: await communication.setAttachmentUploaded(attachment.id, key, mimeType) });
  },
);

router.get("/manager/notifications", requireManager, async (req, res) => {
  res.json({ notifications: await notifications.listForLeg(req.legManager!.legId) });
});
router.post("/manager/notifications/:id/read", requireManager, async (req, res): Promise<void> => {
  const ok = await notifications.markRead(param(req.params.id), req.legManager!.legId);
  if (!ok) { res.status(404).json({ error: "Notification not found or requires action" }); return; }
  res.json({ ok: true });
});

export default router;
