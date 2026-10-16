import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";

const router: IRouter = Router();
const uuid = z.string().uuid();
const descriptionSchema = z.object({
  description: z.union([z.string().max(5000), z.null()]).transform((value) => value?.trim() || null),
}).strict();

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

router.get("/event-profiles/:id/description", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!uuid.safeParse(id).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }
  try {
    const result = await db.execute(sql`select description from organizations where id = ${id}::uuid limit 1`);
    const row = rowsOf<{ description: string | null }>(result)[0];
    if (!row) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ description: row.description ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to load event description");
    res.status(500).json({ error: "Could not load event description." });
  }
});

router.patch("/event-profiles/:id/description", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsedId = uuid.safeParse(id);
  const parsed = descriptionSchema.safeParse(req.body);
  if (!parsedId.success) {
    res.status(400).json({ ok: false, error: "Invalid profile ID." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the event description." });
    return;
  }
  try {
    const result = await db.execute(sql`
      update organizations
      set description = ${parsed.data.description}, updated_at = now()
      where id = ${id}::uuid
      returning id
    `);
    if (!rowsOf<{ id: string }>(result)[0]) {
      res.status(404).json({ ok: false, error: "Profile not found." });
      return;
    }
    res.json({ ok: true, description: parsed.data.description });
  } catch (err) {
    req.log.error({ err }, "Failed to save event description");
    res.status(500).json({ ok: false, error: "Could not save event description." });
  }
});

export default router;
