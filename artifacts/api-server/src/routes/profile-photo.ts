import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";

const router: IRouter = Router();
const uuid = z.string().uuid();
const photoSchema = z.object({
  dataUrl: z.union([
    z.string()
      .max(750_000, "Profile photo is too large.")
      .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Use a JPEG, PNG, or WebP image."),
    z.null(),
  ]),
}).strict();

function idParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/event-profiles/:id/photo", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!uuid.safeParse(id).success) { res.status(400).json({ error: "Invalid profile ID." }); return; }
  try {
    const result = await db.execute(sql`
      select profile_image_data_url as "dataUrl"
      from organizations
      where id=${id}::uuid
      limit 1
    `);
    const row = (result as any).rows?.[0];
    if (!row) { res.status(404).json({ error: "Profile not found." }); return; }
    res.json({ dataUrl: row.dataUrl ?? null });
  } catch (error) {
    req.log.error({ error }, "Failed to load profile photo");
    res.status(500).json({ error: "Could not load profile photo." });
  }
});

router.patch("/event-profiles/:id/photo", async (req, res): Promise<void> => {
  const id = idParam(req.params.id);
  if (!uuid.safeParse(id).success) { res.status(400).json({ error: "Invalid profile ID." }); return; }
  const parsed = photoSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the profile photo." }); return; }
  try {
    const result = await db.execute(sql`
      update organizations
      set profile_image_data_url=${parsed.data.dataUrl}, updated_at=now()
      where id=${id}::uuid
      returning id
    `);
    if (!(result as any).rows?.[0]) { res.status(404).json({ error: "Profile not found." }); return; }
    res.json({ ok: true, dataUrl: parsed.data.dataUrl });
  } catch (error) {
    req.log.error({ error }, "Failed to save profile photo");
    res.status(500).json({ error: "Could not save profile photo." });
  }
});

export default router;
