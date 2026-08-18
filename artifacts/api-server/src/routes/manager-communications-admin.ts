import express, { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { CommunicationRepository, type MessageActor } from "@/features/manager-comms/communication-repository";
import { CommunicationParticipantRepository } from "@/features/manager-comms/communication-participant-repository";
import { NotificationRepository } from "@/features/manager-comms/notification-repository";
import { AcknowledgmentRepository } from "@/features/manager-comms/acknowledgment-repository";
import { AcknowledgmentService } from "@/features/manager-comms/acknowledgment-service";
import { AttachmentFilingDestinationRepository, AttachmentFilingRepository, fileMessageAttachment } from "@/features/manager-comms/attachment-filing-service";
import { createConversationForActor, sendMessageForActor } from "@/features/manager-comms/communication-service";
import { attachFilesToMessages } from "@/features/manager-comms/message-view";
import { sendAdminMessageWithOptionalAcknowledgment } from "@/features/manager-comms/admin-message-acknowledgment";
import { listAdminMessageAcknowledgments } from "@/features/manager-comms/admin-message-acknowledgment-status";

const router: IRouter = Router();
const communication = new CommunicationRepository(db);
const participants = new CommunicationParticipantRepository(db);
const notifications = new NotificationRepository(db);
const acknowledgmentRepository = new AcknowledgmentRepository(db);
const acknowledgments = new AcknowledgmentService(acknowledgmentRepository);
const filing = new AttachmentFilingRepository(db);
const filingDestinations = new AttachmentFilingDestinationRepository(db);
const filingStores = { source: communication, filing, destinations: filingDestinations, notifications };
const storage = new GoogleCloudLegManagerObjectStorage();
const adminActor: MessageActor = { kind: "admin", name: "Admin" };
const serviceStore = {
  createConversation: (input: any) => communication.createConversation(input),
  sendMessage: (input: any) => communication.sendMessage(input),
  listMemberLegIds: (conversationId: string) => participants.listMemberLegIds(conversationId),
};
function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function publicWithoutObjectKey<T extends { objectKey?: unknown }>(value: T) {
  const { objectKey: _privateObjectKey, ...publicValue } = value;
  return publicValue;
}

const conversationInput = z.object({
  kind: z.enum(["all_managers", "leg_admin", "direct", "group"]),
  title: z.string().trim().max(160).nullable().optional(),
  memberLegIds: z.array(z.string().uuid()).max(20),
});
const messageInput = z.object({
  body: z.string().trim().min(1).max(12000),
  clientMutationId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).max(10).optional().default([]),
  requireAcknowledgment: z.boolean().optional().default(false),
  acknowledgmentTitle: z.string().trim().max(160).nullable().optional(),
});
const attachmentInput = z.object({ id: z.string().uuid(), fileName: z.string().trim().max(240).nullable().optional(), mimeType: z.string().trim().max(160).nullable().optional(), sizeBytes: z.number().int().nonnegative().max(12 * 1024 * 1024).nullable().optional(), clientMutationId: z.string().uuid() });
const filingInput = z.object({
  destination: z.enum(["expense_receipt","incident_photo","equipment_handoff_photo","general_leg_document"]),
  destinationMetadata: z.record(z.string(), z.string()),
  clientMutationId: z.string().uuid(),
});

router.get("/manager-admin/messages/conversations", async (_req, res) => { await communication.ensureSchema(); res.json({ conversations: await communication.listAllForAdmin() }); });
router.post("/manager-admin/messages/conversations", async (req, res): Promise<void> => {
  const parsed = conversationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid conversation" }); return; }
  const conversation = await createConversationForActor(serviceStore, adminActor, { kind: parsed.data.kind, title: parsed.data.title ?? null, memberLegIds: parsed.data.memberLegIds });
  res.status(201).json({ conversation });
});
router.get("/manager-admin/messages/conversations/:conversationId", async (req, res) => {
  const conversationId = param(req.params.conversationId);
  const messages = await communication.getMessages(conversationId, adminActor);
  const attachments = await participants.listAttachmentsForMessages(messages.map((message) => message.id));
  await acknowledgmentRepository.ensureSchema();
  const withFiles = await attachFilesToMessages(messages, attachments, storage);
  const enriched = await Promise.all(withFiles.map(async (message) => ({
    ...message,
    acknowledgments: message.actorKind === "admin"
      ? await listAdminMessageAcknowledgments(db, message.id)
      : [],
  })));
  await communication.markConversationReadForAdmin(conversationId);
  res.json({ messages: enriched });
});
router.post("/manager-admin/messages/conversations/:conversationId", async (req, res): Promise<void> => {
  const conversationId = param(req.params.conversationId);
  const parsed = messageInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid message" }); return; }
  const result = await sendAdminMessageWithOptionalAcknowledgment({
    communication: {
      sendMessage: (input) => sendMessageForActor(serviceStore, notifications, input.actor, {
        conversationId: input.conversationId,
        body: input.body,
        clientMutationId: input.clientMutationId,
      }),
      listMemberLegIds: (id) => participants.listMemberLegIds(id),
    },
    acknowledgments,
    actor: adminActor as Extract<MessageActor, { kind: "admin" }>,
    input: {
      conversationId,
      body: parsed.data.body,
      clientMutationId: parsed.data.clientMutationId,
      requireAcknowledgment: parsed.data.requireAcknowledgment,
      acknowledgmentTitle: parsed.data.acknowledgmentTitle ?? null,
    },
  });
  for (const attachmentId of parsed.data.attachmentIds) {
    const attachment = await communication.getAttachment(attachmentId);
    if (!attachment || attachment.conversationId !== conversationId || attachment.uploaderKind !== "admin") continue;
    await communication.attachFileToMessage(attachmentId, result.message.id);
  }
  res.status(201).json(result);
});
router.post("/manager-admin/messages/conversations/:conversationId/attachments", async (req, res): Promise<void> => {
  const conversationId = param(req.params.conversationId);
  const parsed = attachmentInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid attachment" }); return; }
  const attachment = await communication.createAttachment({ id: parsed.data.id, conversationId, actor: adminActor, fileName: parsed.data.fileName ?? null, mimeType: parsed.data.mimeType ?? null, sizeBytes: parsed.data.sizeBytes ?? null, clientMutationId: parsed.data.clientMutationId });
  res.status(201).json({ attachment: publicWithoutObjectKey(attachment) });
});
router.put("/manager-admin/messages/attachments/:attachmentId/file", express.raw({ type: () => true, limit: "12mb" }), async (req, res): Promise<void> => {
  const attachment = await communication.getAttachment(param(req.params.attachmentId));
  if (!attachment || attachment.uploaderKind !== "admin") { res.status(404).json({ error: "Attachment not found" }); return; }
  const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
  if (!bytes.length) { res.status(400).json({ error: "File is required" }); return; }
  const rawType = req.headers["content-type"];
  const mimeType = Array.isArray(rawType) ? rawType[0] ?? "application/octet-stream" : rawType ?? "application/octet-stream";
  const key = `manager-messages/${attachment.conversationId}/${attachment.id}`;
  await storage.put(key, bytes, mimeType);
  const uploaded = await communication.setAttachmentUploaded(attachment.id, key, mimeType);
  res.json({ attachment: uploaded ? publicWithoutObjectKey(uploaded) : null });
});
router.post("/manager-admin/messages/attachments/:attachmentId/file-to-leg", async (req,res):Promise<void>=>{
  const parsed=filingInput.safeParse(req.body);if(!parsed.success){res.status(400).json({error:parsed.error.issues[0]?.message??"Invalid filing request"});return;}
  try{
    const filingResult=await fileMessageAttachment(filingStores,{attachmentId:param(req.params.attachmentId),destination:parsed.data.destination,destinationMetadata:parsed.data.destinationMetadata,adminActor:"Admin",clientMutationId:parsed.data.clientMutationId});
    res.status(201).json({filing:publicWithoutObjectKey(filingResult)});
  }
  catch(error){const code=(error as any)?.code;res.status(code==="NOT_FOUND"?404:code==="FORBIDDEN"?403:400).json({error:(error as Error).message});}
});

router.get("/manager-admin/acknowledgments", async (_req,res)=>{ res.json({acknowledgments:await acknowledgmentRepository.listNeedsAdminReview()}); });
router.post("/manager-admin/acknowledgments/:id/resolve",async(req,res):Promise<void>=>{
  const parsed=z.object({response:z.string().trim().max(4000).nullable().optional()}).safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid admin response"});return;}
  try{res.json({acknowledgment:await acknowledgments.resolve(param(req.params.id),parsed.data.response??null,"Admin")});}
  catch(error){res.status((error as any)?.code==="NOT_FOUND"?404:400).json({error:(error as Error).message});}
});

export default router;
