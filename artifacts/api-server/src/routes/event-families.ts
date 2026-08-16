import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, pool } from "@workspace/db";
import { ScopedNoteRepository } from "@/features/notes/scoped-note-repository";
import { createAiClient, NOT_CONFIGURED_ERROR } from "@/features/ai-suggestions/ai-client";
import { classifyObviousEventFamilies, normalizeFamilyName } from "@/features/event-families/event-family-classifier";
import { suggestEventFamiliesWithAi } from "@/features/event-families/event-family-ai";
import {
  EventFamilyConflictError,
  EventFamilyNotFoundError,
  EventFamilyRepository,
} from "@/features/event-families/event-family-repository";

const router: IRouter = Router();
const idSchema = z.string().uuid();
const renameSchema = z.object({ name: z.string().trim().min(1).max(160) });
const memberSchema = z.object({ organizationId: z.string().uuid() });
const createFamilySchema = z.object({
  name: z.string().trim().min(1).max(160),
  organizationIds: z.array(z.string().uuid()).min(2).max(50),
});
const noteBodySchema = z.object({ body: z.string().trim().min(1, "Add note text.").max(4000) });
const websiteSchema = z.object({ website: z.string().trim().max(500).nullable().or(z.literal("")) });
const contactSearchSchema = z.object({ q: z.string().trim().max(160).optional().default("") });
const familyContactSchema = z.object({
  contactId: z.string().uuid(),
  role: z.string().trim().max(160).nullable().optional(),
  makePrimary: z.boolean().optional().default(false),
});
const newFamilyContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(80).nullable().optional(),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  role: z.string().trim().max(160).nullable().optional(),
  makePrimary: z.boolean().optional().default(false),
});
const familyContactUpdateSchema = z.object({ role: z.string().trim().max(160).nullable(), isPrimary: z.boolean() });

function repo() {
  return new EventFamilyRepository();
}
function noteRepo() {
  return new ScopedNoteRepository(db);
}
function splitName(name: string) {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

function sendError(req: Request, res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ ok: false, error: error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  if (error instanceof EventFamilyNotFoundError) {
    res.status(404).json({ ok: false, error: error.message });
    return;
  }
  if (error instanceof EventFamilyConflictError || (error && typeof error === "object" && "code" in error && (error as any).code === "23505")) {
    res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Membership conflict" });
    return;
  }
  req.log.error({ err: error }, "Event family request failed");
  res.status(500).json({ ok: false, error: "Event family request failed" });
}

router.get("/event-families", async (req, res): Promise<void> => {
  try {
    res.json({ families: await repo().listFamilies() });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/event-families", async (req, res): Promise<void> => {
  try {
    const input = createFamilySchema.parse(req.body);
    const organizationIds = [...new Set(input.organizationIds)];
    if (organizationIds.length < 2) {
      res.status(400).json({ ok: false, error: "Choose at least 2 different profiles." });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const candidates = await client.query(
        `SELECT o.id, o.consolidated_into_id, m.family_id
         FROM organizations o
         LEFT JOIN event_family_members m ON m.organization_id = o.id
         WHERE o.id = ANY($1::uuid[])
         FOR UPDATE OF o`,
        [organizationIds],
      );
      if (candidates.rows.length !== organizationIds.length) {
        throw new EventFamilyConflictError("One or more profiles no longer exist");
      }
      if (candidates.rows.some((row) => row.consolidated_into_id)) {
        throw new EventFamilyConflictError("A retired profile cannot be grouped");
      }
      if (candidates.rows.some((row) => row.family_id)) {
        throw new EventFamilyConflictError("A profile already belongs to another event family");
      }

      const normalizedName = normalizeFamilyName(input.name);
      const existing = await client.query(
        `SELECT id FROM event_families WHERE normalized_name = $1 FOR UPDATE`,
        [normalizedName],
      );
      if (existing.rows[0]) {
        throw new EventFamilyConflictError("An event family with that name already exists");
      }

      const created = await client.query(
        `INSERT INTO event_families (name, normalized_name)
         VALUES ($1, $2)
         RETURNING id`,
        [input.name.trim(), normalizedName],
      );
      const familyId = created.rows[0].id as string;
      for (const organizationId of organizationIds) {
        await client.query(
          `INSERT INTO event_family_members (family_id, organization_id, source)
           VALUES ($1, $2, 'manual')`,
          [familyId, organizationId],
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ ok: true, familyId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    sendError(req, res, error);
  }
});

router.get("/event-families/:id", async (req, res): Promise<void> => {
  try {
    const id = idSchema.parse(req.params.id);
    const family = await repo().getFamily(id);
    if (!family) {
      res.status(404).json({ error: "Event family not found" });
      return;
    }
    res.json({ family });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.patch("/event-families/:id/website", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const parsed = websiteSchema.parse(req.body);
    const changed = await repo().updateWebsite(familyId, parsed.website || null);
    if (!changed) { res.status(404).json({ ok: false, error: "Event family not found" }); return; }
    res.json({ ok: true });
  } catch (error) { sendError(req, res, error); }
});

router.get("/event-families/:id/contact-candidates", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const { q } = contactSearchSchema.parse(req.query);
    res.json({ contacts: await repo().listContactCandidates(familyId, q.trim()) });
  } catch (error) { sendError(req, res, error); }
});

router.post("/event-families/:id/contacts", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const input = familyContactSchema.parse(req.body);
    const contact = await repo().attachContact(familyId, input.contactId, input.role ?? null, input.makePrimary);
    res.status(201).json({ ok: true, contact });
  } catch (error) { sendError(req, res, error); }
});

router.post("/event-families/:id/contacts/new", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const input = newFamilyContactSchema.parse(req.body);
    const { firstName, lastName } = splitName(input.name);
    const contact = await repo().createAndAttachContact(familyId, {
      firstName, lastName, phone: input.phone || null, email: input.email || null, role: input.role ?? null, makePrimary: input.makePrimary,
    });
    res.status(201).json({ ok: true, contact });
  } catch (error) { sendError(req, res, error); }
});

router.patch("/event-families/:id/contacts/:contactId", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const contactId = idSchema.parse(req.params.contactId);
    const input = familyContactUpdateSchema.parse(req.body);
    const contact = await repo().updateFamilyContact(familyId, contactId, input);
    res.json({ ok: true, contact });
  } catch (error) { sendError(req, res, error); }
});

router.delete("/event-families/:id/contacts/:contactId", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const contactId = idSchema.parse(req.params.contactId);
    const changed = await repo().removeFamilyContact(familyId, contactId);
    if (!changed) { res.status(404).json({ ok: false, error: "Family contact not found" }); return; }
    res.json({ ok: true });
  } catch (error) { sendError(req, res, error); }
});

router.get("/event-family-suggestions", async (req, res): Promise<void> => {
  try {
    res.json({ suggestions: await repo().listPendingSuggestions() });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/event-family-suggestions/analyze", async (req, res): Promise<void> => {
  try {
    const repository = repo();
    const candidates = await repository.listAnalysisCandidates();
    const ruleProposals = classifyObviousEventFamilies(candidates);
    const claimedByRules = new Set(ruleProposals.flatMap((proposal) => proposal.candidateIds));
    const unresolved = candidates.filter((candidate) => !claimedByRules.has(candidate.id));

    let aiProposals = [] as Awaited<ReturnType<typeof suggestEventFamiliesWithAi>>;
    if (unresolved.length >= 2) {
      let client;
      try {
        client = await createAiClient();
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error as any).code === NOT_CONFIGURED_ERROR) {
          res.status(503).json({
            ok: false,
            code: NOT_CONFIGURED_ERROR,
            error: "No AI provider is configured",
            ruleSuggestions: ruleProposals.length,
          });
          return;
        }
        throw error;
      }
      aiProposals = await suggestEventFamiliesWithAi(client, unresolved);
    }

    const proposals = [...ruleProposals, ...aiProposals];
    await repository.replacePendingSuggestions(proposals);
    const pending = await repository.listPendingSuggestions();
    res.json({
      ok: true,
      rule: ruleProposals.length,
      ai: aiProposals.length,
      skipped: Math.max(0, candidates.length - new Set(proposals.flatMap((proposal) => proposal.candidateIds)).size),
      pending: pending.length,
      suggestions: pending,
    });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/event-family-suggestions/:id/approve", async (req, res): Promise<void> => {
  try {
    const result = await repo().approveSuggestion(idSchema.parse(req.params.id));
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post("/event-family-suggestions/:id/dismiss", async (req, res): Promise<void> => {
  try {
    const changed = await repo().dismissSuggestion(idSchema.parse(req.params.id));
    if (!changed) {
      res.status(404).json({ ok: false, error: "Suggestion not found" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.patch("/event-families/:id", async (req, res): Promise<void> => {
  try {
    const id = idSchema.parse(req.params.id);
    const { name } = renameSchema.parse(req.body);
    const changed = await repo().renameFamily(id, name);
    if (!changed) {
      res.status(404).json({ ok: false, error: "Event family not found" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.get("/event-families/:id/notes", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    if (!(await noteRepo().ownerExists({ kind: "event_family", id: familyId }))) {
      res.status(404).json({ ok: false, error: "Event family not found" });
      return;
    }
    res.json({ notes: await noteRepo().list({ kind: "event_family", id: familyId }) });
  } catch (error) { sendError(req, res, error); }
});

router.post("/event-families/:id/notes", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const { body } = noteBodySchema.parse(req.body);
    const result = await noteRepo().create({ kind: "event_family", id: familyId }, body);
    if (!result.ok) { res.status(404).json({ ok: false, error: "Note owner not found" }); return; }
    res.status(201).json({ ok: true, note: result.note });
  } catch (error) { sendError(req, res, error); }
});

router.patch("/event-families/:id/notes/:noteId", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const noteId = idSchema.parse(req.params.noteId);
    const { body } = noteBodySchema.parse(req.body);
    const result = await noteRepo().update({ kind: "event_family", id: familyId }, noteId, body);
    if (!result.ok) { res.status(404).json({ ok: false, error: result.code === "OWNER_NOT_FOUND" ? "Note owner not found" : "Note not found for this owner" }); return; }
    res.json({ ok: true, note: result.note });
  } catch (error) { sendError(req, res, error); }
});

router.delete("/event-families/:id/notes/:noteId", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const noteId = idSchema.parse(req.params.noteId);
    const result = await noteRepo().remove({ kind: "event_family", id: familyId }, noteId);
    if (!result.ok) { res.status(404).json({ ok: false, error: result.code === "OWNER_NOT_FOUND" ? "Note owner not found" : "Note not found for this owner" }); return; }
    res.json({ ok: true });
  } catch (error) { sendError(req, res, error); }
});

router.post("/event-families/:id/members", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const { organizationId } = memberSchema.parse(req.body);
    await repo().addMember(familyId, organizationId);
    res.json({ ok: true });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.delete("/event-families/:id/members/:organizationId", async (req, res): Promise<void> => {
  try {
    const familyId = idSchema.parse(req.params.id);
    const organizationId = idSchema.parse(req.params.organizationId);
    const changed = await repo().removeMember(familyId, organizationId);
    if (!changed) {
      res.status(404).json({ ok: false, error: "Family membership not found" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    sendError(req, res, error);
  }
});

export default router;
