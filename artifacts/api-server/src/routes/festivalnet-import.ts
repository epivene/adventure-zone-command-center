import { Router, raw } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  ApplyFestivalNetImportBody, ApplyFestivalNetBatchBody, MatchFestivalNetDraftBody,
  type FestivalNetDraft, type FestivalNetBatchOutcome,
} from "@workspace/api-zod";
import { requireOwnerMiddleware } from "@/lib/auth";
import { parseFestivalNetPdf } from "@/features/festivalnet-import/pdf-parser";
import { applyFestivalNetDraft, findFestivalNetCandidates, ImportConflict } from "@/features/festivalnet-import/import-service";

const router = Router();
router.use(requireOwnerMiddleware);
let activeParses = 0;

function draftError(draft: FestivalNetDraft): string | null {
  const details = draft.details;
  if (!/^https:\/\/(?:www\.)?festivalnet\.com\/\d+\//i.test(draft.sourceUrl) ||
      Object.keys(details).length > 55 ||
      Object.keys(details).some(key => key.length > 80 || ["__proto__", "constructor", "prototype"].includes(key)) ||
      Object.values(details).some(value => value.length > 4000) ||
      ["startsOn", "endsOn", "applicationDeadline", "foodDeadline", "performanceDeadline"].some(key => details[key] && !z.iso.date().safeParse(details[key]).success) ||
      (details.startsOn && details.endsOn && details.endsOn < details.startsOn) ||
      (draft.contactEmail && !z.email().safeParse(draft.contactEmail).success)) {
    return "Review the source link, email and dates. End dates cannot precede start dates.";
  }
  const urls = [draft.website, ...Object.entries(details).filter(([key]) => key.endsWith("Url")).map(([, value]) => value)];
  if (urls.some(value => {
    if (!value) return false;
    try { return !["https:", "http:"].includes(new URL(value).protocol); } catch { return true; }
  })) return "Website and application links must be complete http or https URLs.";
  return null;
}

router.post("/festivalnet-import/matches", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const parsed = MatchFestivalNetDraftBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Review the festival name, event year and extracted fields." }); return; }
  const error = draftError(parsed.data);
  if (error) { res.status(400).json({ error }); return; }
  try { res.json({ candidates: await findFestivalNetCandidates(db, parsed.data) }); }
  catch (error) {
    req.log.error({ error }, "FestivalNet matches failed");
    res.status(503).json({ error: "Matches could not be checked. Keep your edits and try again." });
  }
});

router.post("/festivalnet-import/apply-batch", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  // Validate the envelope first, then each draft separately so one malformed
  // entry does not prevent the other reviewed profiles from being saved.
  const envelope = ApplyFestivalNetBatchBody.pick({ confirmed: true }).extend({
    entries: ApplyFestivalNetBatchBody.shape.entries.element.pick({ entryId: true }).passthrough().array().min(1).max(25),
  });
  const parsed = envelope.safeParse(req.body);
  if (!parsed.success || new Set(parsed.data.entries.map(entry => entry.entryId)).size !== parsed.data.entries.length) {
    res.status(400).json({ error: "Confirm a reviewed batch of 1–25 entries with unique entry IDs." }); return;
  }
  const outcomes: FestivalNetBatchOutcome[] = [];
  for (const entry of parsed.data.entries) {
    const input = ApplyFestivalNetImportBody.safeParse(entry);
    if (!input.success) {
      outcomes.push({ entryId: entry.entryId, result: null, error: "Review this file's name, year, target profile and field lengths." });
      continue;
    }
    const validationError = draftError(input.data.draft);
    if (validationError) { outcomes.push({ entryId: entry.entryId, result: null, error: validationError }); continue; }
    try {
      const result = await applyFestivalNetDraft(input.data.draft, input.data.organizationId, true);
      outcomes.push({ entryId: entry.entryId, result, error: null });
    } catch (error) {
      if (!(error instanceof ImportConflict)) req.log.error({ error, entryId: entry.entryId }, "FestivalNet batch entry failed");
      outcomes.push({ entryId: entry.entryId, result: null, error: error instanceof ImportConflict ? error.message :
        "This file could not be saved. No partial changes for this entry were committed; keep your review and retry." });
    }
  }
  res.json({ outcomes });
});

router.post("/festivalnet-import/preview", raw({ type: "application/pdf", limit: "10mb" }), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const filename = z.string().trim().min(1).max(255).regex(/\.pdf$/i).safeParse(req.query.filename);
  if (!filename.success || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "Upload a PDF file with its original filename." }); return;
  }
  if (activeParses >= 2) { res.status(429).json({ error: "Two PDFs are already being read. Please try again shortly." }); return; }
  activeParses++;
  try {
    const parsed = await parseFestivalNetPdf(new Uint8Array(req.body), filename.data);
    const candidates = await findFestivalNetCandidates(db, parsed.draft);
    res.json({ ...parsed, candidates });
  } catch (error) {
    req.log.warn({ error }, "FestivalNet PDF preview failed");
    // Parser errors are intentionally human-readable; do not expose database/provider details.
    const message = error instanceof Error && /^(This PDF|Choose|The (event|festival)|City|No |An? )/.test(error.message)
      ? error.message : "This PDF could not be read. Upload the full FestivalNet printable event page with selectable text.";
    res.status(400).json({ error: message });
  } finally { activeParses--; }
});

router.post("/festivalnet-import/apply", async (req, res) => {
  const parsed = ApplyFestivalNetImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Review the festival name, event year and extracted fields." }); return; }
  const { draft, organizationId } = parsed.data;
  const error = draftError(draft);
  if (error) { res.status(400).json({ error }); return; }
  try { res.json(await applyFestivalNetDraft(draft, organizationId)); }
  catch (error) {
    if (error instanceof ImportConflict) { res.status(409).json({ error: error.message }); return; }
    req.log.error({ error }, "FestivalNet import failed");
    res.status(503).json({ error: "The import could not be saved. No partial changes were committed; keep this preview and try again." });
  }
});
export default router;
