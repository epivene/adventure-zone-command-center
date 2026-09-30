import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { websitePhotos } from "../features/organizations/website-photo";
import { requireOwnerMiddleware } from "../lib/auth";
import { db } from "@workspace/db";

const router: IRouter = Router();
const uuid = z.string().uuid();
const photoSchema = z.object({
  sourceUrl: z.string().url().regex(/^https:\/\//).max(2048).optional(),
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

router.get("/event-profiles/:id/website-photos", requireOwnerMiddleware, async (req,res): Promise<void> => {
 const id=idParam(req.params.id);
 if(!uuid.safeParse(id).success) {res.status(400).json({error:"Invalid profile ID."});return;}
 try {
  const result=await db.execute(sql`SELECT website FROM organizations WHERE id=${id}::uuid LIMIT 1`);
  const website=(result as any).rows?.[0]?.website;
  if(!website) {res.status(400).json({error:"Add the event's official HTTPS website first."});return;}
  res.json({images:await websitePhotos(website)});
 } catch(error) {res.status(422).json({error:error instanceof Error ? error.message : "Could not load website images."});}
});

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
      WITH changed AS (
        update organizations
        set profile_image_data_url=${parsed.data.dataUrl}, updated_at=now()
        where id=${id}::uuid returning id
      ), source_note AS (
        INSERT INTO activities(id,organization_id,kind,subject,body,occurred_at,timeline_sort_at)
        SELECT gen_random_uuid(),id,'note','Profile photo source',${"Photo selected from: " + (parsed.data.sourceUrl ?? "")},now(),now()
        FROM changed WHERE ${Boolean(parsed.data.sourceUrl && parsed.data.dataUrl)}
      ) SELECT id FROM changed
    `);
    if (!(result as any).rows?.[0]) { res.status(404).json({ error: "Profile not found." }); return; }
    res.json({ ok: true, dataUrl: parsed.data.dataUrl });
  } catch (error) {
    req.log.error({ error }, "Failed to save profile photo");
    res.status(500).json({ error: "Could not save profile photo." });
  }
});

export default router;
