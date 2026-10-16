import { Router } from "express";
import { z } from "zod";
import { requireOwnerMiddleware } from "../lib/auth";
import type { SyncReadModel } from "../features/google-workspace/google-mailbox-sync-read-model";
type Context = {
  connectionId: string;
  read: SyncReadModel;
  check: () => Promise<unknown>;
  configure: (
    mode: "off" | "shadow" | "active",
    limit: 0 | 3 | 50 | 500,
  ) => Promise<unknown>;
};
async function runtime(): Promise<Context> {
  const m =
    await import("../features/google-workspace/google-mailbox-sync-runtime");
  const { PostgresGoogleConnectionRepository } =
    await import("../features/google-workspace/google-connection-repository");
  const account = await new PostgresGoogleConnectionRepository().getCurrent();
  if (!account) throw Error("SYNC_ACCOUNT_UNAVAILABLE");
  return {
    connectionId: account.id,
    read: m.syncReadModel,
    check: m.requestSyncCheck,
    configure: m.configureSync,
  };
}
export function createMailboxSyncRouter(
  context: () => Promise<Context> = runtime,
) {
  const r = Router();
  r.use(requireOwnerMiddleware);
  r.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  r.get("/status", async (_req, res) => {
    const c = await context();
    res.json(await c.read.status(c.connectionId));
  });
  r.get("/reviews", async (req, res) => {
    const q = z
      .object({ cursor: z.string().max(200).optional() })
      .strict()
      .parse(req.query);
    const c = await context();
    res.json(await c.read.reviews(c.connectionId, q.cursor));
  });
  r.get("/threads", async (req, res) => {
    const q = z
      .object({
        profileId: z.string().uuid().optional(),
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .strict()
      .parse(req.query);
    const c = await context();
    res.json(await c.read.list({ connectionId: c.connectionId, ...q }));
  });
  r.get("/thread", async (req, res) => {
    const q = z
      .object({ threadId: z.string().min(1).max(200) })
      .strict()
      .parse(req.query);
    const c = await context();
    const result = await c.read.detail(c.connectionId, q.threadId);
    res
      .status(result ? 200 : 404)
      .json(result ?? { error: "SYNC_THREAD_NOT_FOUND" });
  });
  r.post("/check", async (req, res) => {
    z.object({}).strict().parse(req.body);
    const c = await context();
    res.status(202).json(await c.check());
  });
  r.post("/configure", async (req, res) => {
    const q = z
      .object({
        mode: z.enum(["off", "shadow", "active"]),
        cohortLimit: z.union([
          z.literal(0),
          z.literal(3),
          z.literal(50),
          z.literal(500),
        ]),
      })
      .strict()
      .parse(req.body);
    const c = await context();
    res.json(await c.configure(q.mode, q.cohortLimit));
  });
  r.use((error: any, _req: any, res: any, _next: any) => {
    res
      .status(error instanceof z.ZodError ? 400 : 409)
      .json({
        error:
          error instanceof z.ZodError
            ? "Check the sync fields."
            : typeof error?.message === "string" &&
                /^SYNC_[A-Z_]+$/.test(error.message)
              ? error.message
              : "SYNC_UNAVAILABLE",
      });
  });
  return r;
}
