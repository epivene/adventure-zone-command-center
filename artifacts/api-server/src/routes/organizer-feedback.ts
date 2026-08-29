import { Router, type IRouter } from "express";
import { pool, db } from "@workspace/db";
import { bookings, legManagerAccess } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import {
  buildOrganizerFeedbackEmail,
  createOrganizerFeedbackToken,
  hashOrganizerFeedbackToken,
  organizerFeedbackSubmissionSchema,
  summarizeOrganizerFeedback,
  toManagerOrganizerFeedback,
  type OrganizerFeedbackRecord,
} from "@/features/leg-manager/organizer-feedback-domain";

export const organizerFeedbackPublicRouter: IRouter = Router();
export const organizerFeedbackManagerRouter: IRouter = Router();
export const organizerFeedbackAdminRouter: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));

function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function dateLabel(start: Date | null, end: Date | null) {
  if (!start) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (!end || start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)) return fmt.format(start);
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}
function rowToRecord(row: any): OrganizerFeedbackRecord {
  return {
    id: row.id, bookingId: row.booking_id, legId: row.leg_id, eventName: row.event_name,
    eventDateLabel: row.event_date_label, overallRating: row.overall_rating,
    professionalismRating: row.professionalism_rating, setupRating: row.setup_rating,
    communicationRating: row.communication_rating, inviteBack: row.invite_back,
    comments: row.comments, submittedAt: new Date(row.submitted_at).toISOString(),
    adminNotes: row.admin_notes, managerAcknowledgedAt: row.manager_acknowledged_at ? new Date(row.manager_acknowledged_at).toISOString() : null,
    managerResponse: row.manager_response, managerRespondedAt: row.manager_responded_at ? new Date(row.manager_responded_at).toISOString() : null,
  };
}
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

async function requestByToken(token: string) {
  const hash = hashOrganizerFeedbackToken(token);
  const result = await pool.query(
    `SELECT * FROM event_organizer_feedback_requests WHERE token_hash = $1 LIMIT 1`, [hash],
  );
  return result.rows[0] ?? null;
}

organizerFeedbackPublicRouter.get("/public/organizer-feedback/:token", async (req, res): Promise<void> => {
  const token = param(req.params.token);
  const request = token ? await requestByToken(token) : null;
  if (!request) { res.status(404).type("html").send("<h1>Review link not found</h1>"); return; }
  if (request.expires_at && new Date(request.expires_at) < new Date()) { res.status(410).type("html").send("<h1>This review link has expired.</h1>"); return; }
  const existing = await pool.query(`SELECT id FROM event_organizer_feedback WHERE request_id = $1 LIMIT 1`, [request.id]);
  if (existing.rows[0]) { res.type("html").send("<main style='font-family:Arial;padding:40px;text-align:center'><h1>Thank you!</h1><p>Your feedback has already been received.</p></main>"); return; }
  if (!request.opened_at) await pool.query(`UPDATE event_organizer_feedback_requests SET opened_at = now(), updated_at = now() WHERE id = $1`, [request.id]);
  const requested = Number(req.query.overall);
  const initial = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested : 0;
  const eventName = escapeHtml(String(request.event_name));
  const manager = request.manager_name ? `<p style="color:#64748b">Your leg manager was <strong>${escapeHtml(String(request.manager_name))}</strong>.</p>` : "";
  res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Adventure Zone Review</title></head><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><main style="max-width:620px;margin:auto;padding:20px"><section style="background:white;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden"><header style="background:#f97316;color:white;padding:24px;text-align:center"><h1 style="margin:0">The Adventure Zone</h1><p style="margin:6px 0 0">Event Feedback</p></header><form id="review" style="padding:24px"><h2 style="margin-top:0">How did we do at ${eventName}?</h2>${manager}<div id="fields"></div><label style="display:block;margin:18px 0 8px;font-weight:700">Would you invite The Adventure Zone back?</label><select name="inviteBack" required style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px"><option value="">Choose one</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select><label style="display:block;margin:18px 0 8px;font-weight:700">Anything else you'd like us to know? <span style="font-weight:400">(optional)</span></label><textarea name="comments" rows="5" maxlength="5000" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:8px"></textarea><button type="submit" style="width:100%;margin-top:20px;border:0;border-radius:10px;padding:14px;background:#0f172a;color:white;font-size:16px;font-weight:700">Submit Review</button><p id="status" role="status" style="text-align:center"></p></form></section></main><script>
const initial=${initial}; const fields=[['overallRating','Overall experience'],['professionalismRating','Staff professionalism'],['setupRating','Setup & appearance'],['communicationRating','Communication']]; const root=document.getElementById('fields');
for(const [name,label] of fields){const box=document.createElement('div');box.style.margin='18px 0';box.innerHTML='<div style="font-weight:700;margin-bottom:8px">'+label+'</div><div data-stars="'+name+'" style="display:flex;gap:7px;flex-wrap:wrap"></div><input type="hidden" name="'+name+'" required>';root.appendChild(box);const stars=box.querySelector('[data-stars]');const hidden=box.querySelector('input');for(let n=1;n<=5;n++){const b=document.createElement('button');b.type='button';b.textContent='★';b.setAttribute('aria-label',n+' out of 5');b.style='font-size:36px;background:none;border:0;padding:0;color:#cbd5e1;cursor:pointer';b.onclick=()=>{hidden.value=String(n);[...stars.children].forEach((x,i)=>x.style.color=i<n?'#f59e0b':'#cbd5e1')};stars.appendChild(b)}if(name==='overallRating'&&initial)stars.children[initial-1].click()}
document.getElementById('review').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());for(const key of ['overallRating','professionalismRating','setupRating','communicationRating']) payload[key]=Number(payload[key]);const status=document.getElementById('status');status.textContent='Sending…';const response=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});if(response.ok){document.querySelector('form').innerHTML='<div style="padding:30px 0;text-align:center"><h2>Thank you! ⭐</h2><p>Your feedback has been received.</p></div>'}else{const body=await response.json().catch(()=>({}));status.textContent=body.error||'Could not submit your review. Please try again.'}});
</script></body></html>`);
});

organizerFeedbackPublicRouter.post("/public/organizer-feedback/:token", async (req, res): Promise<void> => {
  const parsed = organizerFeedbackSubmissionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid review" }); return; }
  const request = await requestByToken(param(req.params.token));
  if (!request) { res.status(404).json({ error: "Review link not found" }); return; }
  if (request.expires_at && new Date(request.expires_at) < new Date()) { res.status(410).json({ error: "Review link expired" }); return; }
  const value = parsed.data;
  const inserted = await pool.query(`INSERT INTO event_organizer_feedback
    (request_id, booking_id, leg_id, event_name, event_date_label, overall_rating, professionalism_rating, setup_rating, communication_rating, invite_back, comments)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (request_id) DO NOTHING RETURNING id`,
    [request.id, request.booking_id, request.leg_id, request.event_name, request.event_date_label, value.overallRating, value.professionalismRating, value.setupRating, value.communicationRating, value.inviteBack, value.comments?.trim() || null]);
  if (!inserted.rows[0]) { res.status(409).json({ error: "This review has already been submitted" }); return; }
  await pool.query(`UPDATE event_organizer_feedback_requests SET completed_at = now(), updated_at = now() WHERE id = $1`, [request.id]);
  res.status(201).json({ ok: true });
});

organizerFeedbackManagerRouter.get("/manager/organizer-feedback", requireManager, async (req, res) => {
  const result = await pool.query(`SELECT * FROM event_organizer_feedback WHERE leg_id = $1 ORDER BY submitted_at DESC`, [req.legManager!.legId]);
  const records = result.rows.map(rowToRecord);
  res.json({ reviews: records.map(toManagerOrganizerFeedback), summary: summarizeOrganizerFeedback(records) });
});
const responseSchema = z.object({ response: z.string().trim().max(3000).nullable().optional() });
organizerFeedbackManagerRouter.post("/manager/organizer-feedback/:reviewId/acknowledge", requireManager, async (req, res): Promise<void> => {
  const parsed = responseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid response" }); return; }
  const result = await pool.query(`UPDATE event_organizer_feedback SET manager_acknowledged_at = COALESCE(manager_acknowledged_at, now()), manager_response = COALESCE($3, manager_response), manager_responded_at = CASE WHEN $3 IS NULL THEN manager_responded_at ELSE now() END, updated_at = now() WHERE id = $1 AND leg_id = $2 RETURNING *`, [param(req.params.reviewId), req.legManager!.legId, parsed.data.response?.trim() || null]);
  if (!result.rows[0]) { res.status(404).json({ error: "Review not found" }); return; }
  res.json({ review: toManagerOrganizerFeedback(rowToRecord(result.rows[0])) });
});

const requestSchema = z.object({ recipientName: z.string().trim().max(160).nullable().optional(), recipientEmail: z.string().trim().email().max(320).nullable().optional(), expiresInDays: z.number().int().min(7).max(365).optional().default(90) });
organizerFeedbackAdminRouter.post("/organizer-feedback/admin/bookings/:bookingId/request", async (req, res): Promise<void> => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid review request" }); return; }
  const booking = (await db.select({ id: bookings.id, name: bookings.name, startsAt: bookings.startsAt, endsAt: bookings.endsAt, travelLegId: bookings.travelLegId }).from(bookings).where(eq(bookings.id, param(req.params.bookingId))).limit(1))[0];
  if (!booking) { res.status(404).json({ error: "Event not found" }); return; }
  if (!booking.travelLegId) { res.status(409).json({ error: "Assign a leg manager before requesting organizer feedback" }); return; }
  const manager = (await db.select({ managerName: legManagerAccess.managerName }).from(legManagerAccess).where(eq(legManagerAccess.legId, booking.travelLegId)).limit(1))[0];
  const token = createOrganizerFeedbackToken();
  const label = dateLabel(booking.startsAt, booking.endsAt);
  const row = (await pool.query(`INSERT INTO event_organizer_feedback_requests (booking_id, leg_id, event_name, event_date_label, manager_name, recipient_name, recipient_email, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+($9::text || ' days')::interval) RETURNING id`, [booking.id, booking.travelLegId, booking.name, label, manager?.managerName ?? null, parsed.data.recipientName ?? null, parsed.data.recipientEmail ?? null, hashOrganizerFeedbackToken(token), parsed.data.expiresInDays])).rows[0];
  const reviewUrl = `${req.protocol}://${req.get("host")}${req.baseUrl}/public/organizer-feedback/${encodeURIComponent(token)}`;
  const email = buildOrganizerFeedbackEmail({ eventName: booking.name, eventDateLabel: label, managerName: manager?.managerName ?? null, reviewUrl });
  res.status(201).json({ requestId: row.id, reviewUrl, recipientName: parsed.data.recipientName ?? null, recipientEmail: parsed.data.recipientEmail ?? null, ...email });
});
organizerFeedbackAdminRouter.get("/organizer-feedback/admin/bookings/:bookingId", async (req, res) => {
  const result = await pool.query(`SELECT * FROM event_organizer_feedback WHERE booking_id = $1 ORDER BY submitted_at DESC`, [param(req.params.bookingId)]);
  const requests = await pool.query(`SELECT id, recipient_name, recipient_email, created_at, opened_at, completed_at, expires_at FROM event_organizer_feedback_requests WHERE booking_id = $1 ORDER BY created_at DESC`, [param(req.params.bookingId)]);
  res.json({ reviews: result.rows.map(rowToRecord), requests: requests.rows });
});
const adminNoteSchema = z.object({ adminNotes: z.string().trim().max(5000).nullable() });
organizerFeedbackAdminRouter.patch("/organizer-feedback/admin/:reviewId/admin-notes", async (req, res): Promise<void> => {
  const parsed = adminNoteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid admin note" }); return; }
  const result = await pool.query(`UPDATE event_organizer_feedback SET admin_notes = $2, updated_at = now() WHERE id = $1 RETURNING *`, [param(req.params.reviewId), parsed.data.adminNotes || null]);
  if (!result.rows[0]) { res.status(404).json({ error: "Review not found" }); return; }
  res.json({ review: rowToRecord(result.rows[0]) });
});
