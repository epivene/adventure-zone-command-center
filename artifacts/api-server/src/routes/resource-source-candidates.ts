import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { resourceSourceCandidates } from "@/db/schema";
import { DrizzleResourceIntelligenceSettingsRepository } from "@/features/resources/resource-intelligence-settings";
import { ensureResourceSourceCandidateSeed } from "@/features/resources/resource-source-candidate-seed";
import { canApplySourceIdentity } from "@/features/resources/resource-source-candidates";

const router: IRouter = Router();
const uuid = z.string().uuid();
const linkInput = z.object({ resourceId: z.string().uuid() }).strict();
const ignoreInput = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/settings/resource-source-candidates", async (req, res): Promise<void> => {
  try {
    await ensureResourceSourceCandidateSeed(db);
    const [candidates, resources] = await Promise.all([
      db.select().from(resourceSourceCandidates).orderBy(asc(resourceSourceCandidates.serialNumber)),
      new DrizzleResourceIntelligenceSettingsRepository(db).listResources(),
    ]);
    res.json({ candidates, resources });
  } catch (err) {
    req.log.error({ err }, "Failed to load imported asset candidates");
    res.status(500).json({ error: "Could not load imported asset details." });
  }
});

router.post("/settings/resource-source-candidates/:candidateId/link", async (req, res): Promise<void> => {
  const candidateId = param(req.params.candidateId);
  const parsedId = uuid.safeParse(candidateId);
  const parsed = linkInput.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: "Choose a valid imported asset and resource." });
    return;
  }

  await ensureResourceSourceCandidateSeed(db);
  const candidate = (
    await db
      .select()
      .from(resourceSourceCandidates)
      .where(eq(resourceSourceCandidates.id, candidateId))
      .limit(1)
  )[0];
  if (!candidate) {
    res.status(404).json({ error: "Imported asset not found." });
    return;
  }

  const resources = await new DrizzleResourceIntelligenceSettingsRepository(db).listResources();
  const resource = resources.find((item) => item.id === parsed.data.resourceId);
  if (!resource) {
    res.status(404).json({ error: "Resource not found." });
    return;
  }
  if (resource.status === "archived") {
    res.status(409).json({ error: "Archived resources cannot receive imported asset identity." });
    return;
  }

  const sourceIdentity = {
    yearBuilt: candidate.yearBuilt,
    make: candidate.make,
    model: candidate.model,
    serialNumber: candidate.serialNumber,
  };
  const currentIdentity = {
    yearBuilt: resource.yearBuilt,
    make: resource.make,
    model: resource.model,
    serialNumber: resource.serialNumber,
  };
  const compatibility = canApplySourceIdentity(currentIdentity, sourceIdentity);
  if (!compatibility.allowed) {
    res.status(409).json({
      error: "This resource already has conflicting identity details. Review them before linking.",
      conflicts: compatibility.conflicts,
      current: currentIdentity,
      source: sourceIdentity,
    });
    return;
  }

  await reconcileCapacityFacts(db,"resource-inventory",async (transaction) => {
    await transaction.execute(sql`
      update resources
      set
        year_built = coalesce(year_built, ${candidate.yearBuilt}),
        make = coalesce(make, ${candidate.make}),
        model = coalesce(model, ${candidate.model}),
        serial_number = coalesce(serial_number, ${candidate.serialNumber}),
        updated_at = now()
      where id = ${resource.id}::uuid
    `);
    await transaction
      .update(resourceSourceCandidates)
      .set({
        matchedResourceId: resource.id,
        matchState: "applied",
        matchNote: "Owner linked this source identity to an existing resource.",
        updatedAt: new Date(),
      })
      .where(eq(resourceSourceCandidates.id, candidate.id));
  });

  res.json({ ok: true });
});

router.post("/settings/resource-source-candidates/:candidateId/ignore", async (req, res): Promise<void> => {
  const candidateId = param(req.params.candidateId);
  const parsedId = uuid.safeParse(candidateId);
  const parsed = ignoreInput.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid imported asset ID." : "Add a reason for ignoring this source asset." });
    return;
  }

  await ensureResourceSourceCandidateSeed(db);
  const [candidate] = await db
    .update(resourceSourceCandidates)
    .set({
      matchedResourceId: null,
      matchState: "ignored",
      matchNote: `Ignored by owner: ${parsed.data.reason}`,
      updatedAt: new Date(),
    })
    .where(eq(resourceSourceCandidates.id, candidateId))
    .returning();
  if (!candidate) {
    res.status(404).json({ error: "Imported asset not found." });
    return;
  }
  res.json({ candidate });
});

export default router;
