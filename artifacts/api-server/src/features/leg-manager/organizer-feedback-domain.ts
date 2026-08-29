import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const organizerFeedbackSubmissionSchema = z.object({
  overallRating: z.number().int().min(1).max(5),
  professionalismRating: z.number().int().min(1).max(5),
  setupRating: z.number().int().min(1).max(5),
  communicationRating: z.number().int().min(1).max(5),
  inviteBack: z.enum(["yes", "maybe", "no"]),
  comments: z.string().trim().max(5000).nullable().optional(),
});

export type OrganizerFeedbackSubmission = z.infer<typeof organizerFeedbackSubmissionSchema>;

export function createOrganizerFeedbackToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOrganizerFeedbackToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildOrganizerFeedbackEmail(input: {
  eventName: string;
  eventDateLabel?: string | null;
  managerName?: string | null;
  reviewUrl: string;
}) {
  const eventName = input.eventName.trim();
  const date = input.eventDateLabel?.trim() || "your recent event";
  const managerLine = input.managerName?.trim()
    ? `Your Adventure Zone leg manager was ${input.managerName.trim()}.`
    : "";
  const starLinks = [1, 2, 3, 4, 5]
    .map((rating) => `<a href="${escapeHtml(input.reviewUrl)}?overall=${rating}" style="display:inline-block;text-decoration:none;font-size:34px;line-height:40px;color:#f59e0b;padding:0 3px" aria-label="Rate ${rating} out of 5">★</a>`)
    .join("");

  const subject = `How did The Adventure Zone do at ${eventName}?`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden"><tr><td style="background:#f97316;color:#ffffff;padding:24px;text-align:center"><div style="font-size:25px;font-weight:800">The Adventure Zone</div><div style="margin-top:4px;font-size:14px">Thanks for having us!</div></td></tr><tr><td style="padding:28px"><h1 style="font-size:24px;margin:0 0 12px">How did we do?</h1><p style="font-size:16px;line-height:24px;margin:0 0 8px">Thank you for having The Adventure Zone at <strong>${escapeHtml(eventName)}</strong> (${escapeHtml(date)}).</p>${managerLine ? `<p style="font-size:15px;line-height:22px;margin:0 0 18px;color:#475569">${escapeHtml(managerLine)}</p>` : ""}<p style="font-size:16px;line-height:24px;margin:0 0 10px">Tap a star to start your review. It takes about a minute.</p><div style="text-align:center;margin:18px 0 24px">${starLinks}</div><div style="text-align:center"><a href="${escapeHtml(input.reviewUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px">Leave Your Review</a></div><p style="font-size:13px;line-height:20px;color:#64748b;margin:24px 0 0">Your feedback helps us recognize great work and improve future events.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `Thanks for having The Adventure Zone at ${eventName} (${date}).\n\nHow did we do? Leave your review here: ${input.reviewUrl}\n\n${managerLine ? `${managerLine}\n\n` : ""}Your feedback helps us recognize great work and improve future events.`;
  return { subject, html, text };
}

export type OrganizerFeedbackRecord = {
  id: string;
  bookingId: string;
  legId: string;
  eventName: string;
  eventDateLabel: string | null;
  overallRating: number;
  professionalismRating: number;
  setupRating: number;
  communicationRating: number;
  inviteBack: "yes" | "maybe" | "no";
  comments: string | null;
  submittedAt: string;
  adminNotes: string | null;
  managerAcknowledgedAt: string | null;
  managerResponse: string | null;
  managerRespondedAt: string | null;
};

export function toManagerOrganizerFeedback(record: OrganizerFeedbackRecord) {
  const { adminNotes: _adminNotes, ...managerSafe } = record;
  return managerSafe;
}

export function summarizeOrganizerFeedback(records: Array<Pick<OrganizerFeedbackRecord, "overallRating" | "inviteBack">>) {
  if (!records.length) return { reviewCount: 0, averageOverallRating: null, inviteBackRate: null };
  const averageOverallRating = records.reduce((sum, row) => sum + row.overallRating, 0) / records.length;
  const yesCount = records.filter((row) => row.inviteBack === "yes").length;
  return {
    reviewCount: records.length,
    averageOverallRating: Math.round(averageOverallRating * 10) / 10,
    inviteBackRate: Math.round((yesCount / records.length) * 100),
  };
}
