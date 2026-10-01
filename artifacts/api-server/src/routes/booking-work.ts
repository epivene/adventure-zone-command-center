import { Router } from "express";
import { z } from "zod";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  ConnectionError,
  type ConnectionDatabase,
} from "../features/chatgpt-connection/contracts";
import { BookingWorkService } from "../features/booking-work/service";
import {
  BookingWorkRepository,
  WorkConflict,
} from "../features/booking-work/repository";
import {
  createWorkSchema,
  patchWorkSchema,
  filterSchema,
  actorSchema,
} from "../features/booking-work/contracts";
export function createBookingWorkRouter(db: ConnectionDatabase) {
  const r = Router(),
    s = new BookingWorkService(db);
  r.use(requireOwnerMiddleware);
  r.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const id = z.string().uuid(),
    revision = z.number().int().positive();
  r.get("/", async (req, res) => {
    const q = { ...req.query } as any;
    for (const k of ["eventYear", "limit"])
      if (q[k] !== undefined) q[k] = Number(q[k]);
    if (q.actor) q.actor = JSON.parse(q.actor);
    res.json(await new BookingWorkRepository(db).list(filterSchema.parse(q)));
  });
  r.get("/actors", async (_req, res) => {
    const rows = (
      await db.query(
        "SELECT id,client_id FROM chatgpt_connections WHERE owner_id='owner' AND revoked_at IS NULL ORDER BY created_at DESC",
      )
    ).rows;
    res.json([
      { kind: "owner", id: "owner", label: "Desiree / owner" },
      ...rows.map((r) => ({
        kind: "connection",
        id: r.id,
        label: `Com connection (${r.client_id})`,
      })),
    ]);
  });
  r.get("/:id", async (req, res) => {
    const a = await new BookingWorkRepository(db).read(id.parse(req.params.id));
    if (!a) return res.status(404).json({ error: "WORK_NOT_FOUND" });
    res.json(a);
  });
  r.post("/", async (req, res) => {
    const a = await s.ownerCreate(createWorkSchema.parse(req.body));
    res.status(a.created ? 201 : 200).json(a);
  });
  r.patch("/:id", async (req, res) => {
    const p = z
      .object({ revision, patch: patchWorkSchema })
      .strict()
      .parse(req.body);
    res.json(await s.ownerUpdate(id.parse(req.params.id), p.revision, p.patch));
  });
  r.post("/:id/reassign", async (req, res) => {
    const p = z
      .object({ revision, actor: actorSchema.nullable() })
      .strict()
      .parse(req.body);
    res.json(await s.reassign(id.parse(req.params.id), p.revision, p.actor));
  });
  r.use((e: any, _req: any, res: any, _next: any) => {
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return res.status(400).json({ error: "Review the task fields." });
    if (e instanceof ConnectionError)
      return res
        .status(e.status)
        .json({
          error: e.code,
          ...(e instanceof WorkConflict ? { current: e.current } : {}),
        });
    res
      .status(500)
      .json({ error: "Could not save booking work. Refresh before retrying." });
  });
  return r;
}
