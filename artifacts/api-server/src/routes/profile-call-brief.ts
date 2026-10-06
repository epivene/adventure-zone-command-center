import { Router } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireOwnerMiddleware } from "../lib/auth";

const router = Router();
router.get("/profiles/:profileId/call-brief", requireOwnerMiddleware, async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.profileId);
  if (!parsed.success) { res.status(400).json({ error: "PROFILE_ID_INVALID" }); return; }
  try {
    const organizationId = parsed.data;
    const [bookings, holds] = await Promise.all([
      pool.query(`
        SELECT b.id::text AS "bookingId",
          COALESCE((SELECT jsonb_agg(p.name ORDER BY p.name) FROM booking_package_selections s
          JOIN package_templates p ON p.id=s.package_template_id WHERE s.booking_id=b.id),'[]'::jsonb) AS packages,
          cv.status AS "contractStatus", cv.id::text AS "contractId",
          COALESCE(cv.snapshot,cd.values) AS terms,
          CASE WHEN cv.id IS NOT NULL THEN 'contract' WHEN cd.id IS NOT NULL THEN 'draft' ELSE NULL END AS "termsSource",
          inv.id::text AS "invoiceId", inv.status AS "invoiceStatus",
          inv.total_cents AS "totalCents", inv.deposit_cents AS "depositCents",
          inv.deposit_due_date AS "depositDueDate",
          (SELECT COALESCE(sum(p.amount_cents),0) FROM invoice_payments p WHERE p.invoice_id=inv.id AND p.voided_at IS NULL) AS "paidCents"
        FROM bookings b
        LEFT JOIN LATERAL (SELECT * FROM contract_versions v WHERE v.booking_id=b.id
          AND v.status NOT IN ('cancelled','declined','superseded') ORDER BY version_number DESC LIMIT 1) cv ON true
        LEFT JOIN LATERAL (SELECT * FROM contract_drafts d WHERE d.booking_id=b.id AND d.finalized_at IS NULL ORDER BY updated_at DESC LIMIT 1) cd ON true
        LEFT JOIN LATERAL (SELECT * FROM invoices i WHERE i.booking_id=b.id AND i.cancelled_at IS NULL ORDER BY issue_date DESC,created_at DESC LIMIT 1) inv ON true
        WHERE b.organization_id=$1`, [organizationId]),
      pool.query(`SELECT c.id::text AS "contactId", p.number, p.do_not_call_reason AS reason
        FROM contact_phones p JOIN contacts c ON c.id=p.contact_id
        JOIN organization_contacts oc ON oc.contact_id=c.id
        WHERE oc.organization_id=$1 AND oc.active AND p.do_not_call_at IS NOT NULL`, [organizationId]),
    ]);
    res.json({ bookings: bookings.rows.map(({ terms, ...row }) => {
      const values = terms && typeof terms === "object" ? terms : {};
      return { ...row, commercialTerms: values.commercialTerms ?? null };
    }), holds: holds.rows });
  } catch {
    res.status(503).json({ error: "PROFILE_CALL_BRIEF_UNAVAILABLE" });
  }
});
export default router;
