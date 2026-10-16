import { Router } from "express";
import { z } from "zod";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  attentionInputSchema,
  attentionApplySchema,
  type EmailThreadAttentionService,
} from "../features/google-workspace/email-thread-attention-service";
export function createEmailThreadAttentionRouter(
  service: EmailThreadAttentionService,
) {
  const r = Router();
  r.use(requireOwnerMiddleware);
  r.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const actor = { ownerId: "owner", connectorId: null };
  r.get("/pilot", async (_req,res)=>{
    const {readPilotSync}=await import("../features/google-workspace/google-pilot-sync-runtime");
    res.json(await readPilotSync());
  });
  r.post("/pilot/sync", async (req,res)=>{
    z.object({}).strict().parse(req.body);
    const {pilotSync,readPilotSync}=await import("../features/google-workspace/google-pilot-sync-runtime");
    await pilotSync.run();
    res.json(await readPilotSync());
  });
  r.get("/list", async (req, res) => {
    const input = z.object({gmailConnectionId:z.string().uuid(),state:z.enum(["needs_your_reply","waiting_for_their_reply"]),cursor:z.string().max(2000).optional(),limit:z.coerce.number().int().min(1).max(100).optional()}).strict().parse(req.query);
    res.json(await service.list(actor,input));
  });
  r.get("/context", async (req, res) => {
    const q = z
      .object({ messageId: z.string().min(1).max(200) })
      .strict()
      .parse(req.query);
    res.json(await service.context(actor, q.messageId));
  });
  r.post("/preview", async (req, res) => {
    res.json(
      await service.preview(actor, attentionInputSchema.parse(req.body)),
    );
  });
  r.post("/apply", async (req, res) => {
    res.json(await service.apply(actor, attentionApplySchema.parse(req.body)));
  });
  r.get("/", async (req, res) => {
    res.json(
      await service.read(
        actor,
        z
          .object({
            gmailConnectionId: z.string().uuid(),
            threadId: z.string().min(1).max(200),
          })
          .strict()
          .parse(req.query),
      ),
    );
  });
  r.use((e: any, _req: any, res: any, _next: any) => {
    if (e instanceof z.ZodError)
      return res.status(400).json({ error: "Check the conversation fields." });
    const code =
      e instanceof Error &&
      /^(EMAIL_ATTENTION_|GOOGLE_WORKSPACE_)/.test(e.message)
        ? e.message
        : "EMAIL_ATTENTION_FAILED";
    res
      .status(code === "EMAIL_ATTENTION_ACCESS" ? 403 : 409)
      .json({ error: code });
  });
  return r;
}
