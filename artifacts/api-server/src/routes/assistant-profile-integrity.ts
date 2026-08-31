import { Router, type IRouter } from "express";

import { pool } from "@workspace/db";
import { ProfileIntegrityAuditService } from "@/features/profile-integrity/profile-integrity-audit";
import { inspectOrganizationReferenceBlockers } from "@/features/profile-integrity/organization-reference-inspector";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function readProfileId(value: string | string[] | undefined): string | null {
  const profileId = Array.isArray(value) ? value[0] : value;
  return profileId && UUID_PATTERN.test(profileId) ? profileId : null;
}

router.use(requireAssistantImportToken);

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
  const profileId = readProfileId(req.params.profileId);
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
  const profileId = readProfileId(req.params.profileId);
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
