import { Router, type IRouter } from "express";
import { z } from "zod";

import { db, pool } from "@workspace/db";
import { addProfileAsLocation } from "@/features/organizations/add-profile-as-location";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { ProfileIntegrityAuditService } from "@/features/profile-integrity/profile-integrity-audit";
import { readProfileIntegrityId } from "@/features/profile-integrity/profile-integrity-input";
import { inspectOrganizationReferenceBlockers } from "@/features/profile-integrity/organization-reference-inspector";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

const profileMergeSchema = z.object({
  canonicalOrgId: z.string().uuid(),
  sourceOrgId: z.string().uuid(),
  label: z.string().trim().min(1).max(240).optional(),
}).strict().refine(
  (input) => input.canonicalOrgId !== input.sourceOrgId,
  { message: "A profile cannot be merged into itself." },
);

router.use(requireAssistantImportToken);

router.post("/profile-merge", async (req, res): Promise<void> => {
  const parsed = profileMergeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the profile merge.",
    });
    return;
  }

  try {
    const result = await addProfileAsLocation(db, parsed.data, new Date());
    res.json({
      ok: true,
      canonicalOrgId: parsed.data.canonicalOrgId,
      sourceOrgId: parsed.data.sourceOrgId,
      locationId: result.locationId,
    });
  } catch (error) {
    if (error instanceof OrganizationConflictError) {
      res.status(409).json({ ok: false, error: error.message });
      return;
    }
    req.log.error({ err: error }, "Failed protected profile merge");
    res.status(500).json({ ok: false, error: "Profile merge failed." });
  }
});

router.get("/profile-integrity-audit", async (req, res): Promise<void> => {
  try {
    const report = await new ProfileIntegrityAuditService().run(new Date());
    res.json(report);
  } catch (error) {
    req.log.error({ err: error }, "Failed read-only profile integrity audit");
    res.status(500).json({
      ok: false,
      error: "PROFILE_INTEGRITY_AUDIT_FAILED",
    });
  }
});

router.get("/profile-integrity-references/:profileId", async (req, res): Promise<void> => {
  const profileId = readProfileIntegrityId(req.params.profileId);
  if (!profileId) {
    res.status(400).json({ ok: false, error: "PROFILE_INTEGRITY_PROFILE_ID_INVALID" });
    return;
  }

  try {
    const references = await inspectOrganizationReferenceBlockers(profileId);
    res.json({
      ok: true,
      mode: "read_only",
      profileId,
      referenceCount: references.reduce((sum, reference) => sum + reference.count, 0),
      references,
    });
  } catch (error) {
    req.log.error({ err: error, profileId }, "Failed profile reference evidence read");
    res.status(500).json({
      ok: false,
      error: "PROFILE_INTEGRITY_REFERENCE_READ_FAILED",
    });
  }
});

router.get("/profile-integrity-calendar-links/:profileId", async (req, res): Promise<void> => {
  const profileId = readProfileIntegrityId(req.params.profileId);
  if (!profileId) {
    res.status(400).json({ ok: false, error: "PROFILE_INTEGRITY_PROFILE_ID_INVALID" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT
         o.id::text AS profile_id,
         o.name AS profile_name,
         b.id::text AS appearance_id,
         b.name AS appearance_name,
         b.status::text AS appearance_status,
         b.starts_at,
         b.ends_at,
         b.notes AS appearance_notes,
         l.id::text AS link_id,
         l.calendar_id,
         l.google_event_id,
         l.package_key,
         l.source_checksum,
         l.last_app_snapshot,
         l.reserved_starts_at,
         l.reserved_ends_at,
         l.last_synced_at,
         l.last_error_code,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', r.id,
               'reason', r.reason,
               'state', r.state,
               'proposedChanges', r.proposed_changes,
               'reviewedBy', r.reviewed_by,
               'reviewedAt', r.reviewed_at,
               'createdAt', r.created_at
             ) ORDER BY r.created_at
           ) FILTER (WHERE r.id IS NOT NULL),
           '[]'::jsonb
         ) AS reviews
       FROM organizations o
       JOIN bookings b ON b.organization_id = o.id
       JOIN google_operational_calendar_links l ON l.booking_id = b.id
       LEFT JOIN google_operational_calendar_reviews r
         ON r.link_id = l.id
         OR (
           r.connection_id = l.connection_id
           AND r.calendar_id = l.calendar_id
           AND r.google_event_id = l.google_event_id
         )
       WHERE o.id = $1::uuid
       GROUP BY o.id, o.name, b.id, b.name, b.status, b.starts_at, b.ends_at,
                b.notes, l.id, l.calendar_id, l.google_event_id, l.package_key,
                l.source_checksum, l.last_app_snapshot, l.reserved_starts_at,
                l.reserved_ends_at, l.last_synced_at, l.last_error_code
       ORDER BY b.starts_at NULLS LAST, b.id, l.package_key`,
      [profileId],
    );

    res.json({ ok: true, profileId, links: result.rows });
  } catch (error) {
    req.log.error({ err: error, profileId }, "Failed profile calendar-link evidence read");
    res.status(500).json({
      ok: false,
      error: "PROFILE_INTEGRITY_CALENDAR_LINK_READ_FAILED",
    });
  }
});

export default router;
