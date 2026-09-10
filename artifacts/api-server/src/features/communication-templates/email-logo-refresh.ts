import { updateConventionHeader } from "./email-header";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export const EMAIL_LOGO_URL = "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-logo-tagline-20260910.png";
const previousLogo = "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-logo-navy.png";
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Refresh the logo and convention header without re-seeding authored body copy. */
export function replaceEmailLogo(html: string): string {
  return updateConventionHeader(html.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix: string, quote: string, src: string) => src === previousLogo
      ? `${prefix}${quote}${EMAIL_LOGO_URL}${quote}` : match));
}

type ReviewRow = {
  id: string; template_id: string; template_version: string | null;
  subject_snapshot: string | null; body_snapshot: string;
  body_format_snapshot: "html" | "plain_text"; content_fingerprint: string; decision: string;
};

/** Idempotent data refresh, including when Dave opens an existing request directly. */
export async function refreshEmailLogos(database: Pick<NodePgDatabase<any>, "transaction">): Promise<void> {
  await database.transaction(async tx => {
    // Lock parents in stable order, as the approval transaction does, before editing snapshots.
    const requests = await tx.execute<{id: string; state: string; deduplication_key: string | null}>(sql`
      select p.id, p.state, p.deduplication_key from boss_work_requests p
      where p.state in ('waiting_on_dave','in_progress','submitted_to_owner','changes_requested','returned_for_clarification')
        and exists (select 1 from communication_template_reviews r where r.request_id=p.id
          and r.decision='pending' and r.body_format_snapshot='html' and (strpos(r.body_snapshot, ${previousLogo}) > 0 or (strpos(r.body_snapshot, ${EMAIL_LOGO_URL}) > 0 and strpos(r.body_snapshot, 'data-convention-header="v2"') = 0)))
      order by p.id for update
    `);
    for (const request of requests.rows) {
      const result = await tx.execute<ReviewRow>(sql`
        select id, template_id, template_version, subject_snapshot, body_snapshot,
          body_format_snapshot, content_fingerprint, decision
        from communication_template_reviews where request_id=${request.id} order by position
      `);
      let changed = false;
      for (const review of result.rows) {
        if (review.decision !== "pending" || review.body_format_snapshot !== "html") continue;
        const body = replaceEmailLogo(review.body_snapshot);
        if (body === review.body_snapshot) continue;
        review.content_fingerprint = fingerprint({
          templateVersion: review.template_version,
          subjectTemplate: review.subject_snapshot,
          bodyTemplate: body,
          bodyFormat: review.body_format_snapshot,
        });
        await tx.execute(sql`update communication_template_reviews set body_snapshot=${body},
          content_fingerprint=${review.content_fingerprint}, verified_links='[]'::jsonb, updated_at=now()
          where id=${review.id} and decision='pending'`);
        changed = true;
      }
      if (!changed) continue;
      // Clear the old content dedupe key. The refreshed request retains its identity and order.
      // A later explicit send is a new review version; completed decisions are never inherited.
      await tx.execute(sql`update boss_work_requests set deduplication_key=null, updated_at=now() where id=${request.id}`);
      await tx.execute(sql`insert into boss_work_request_events
        (request_id,actor_kind,actor_id,prior_state,new_state,note)
        values (${request.id},'system','system:email-logo-refresh',${request.state},${request.state},
          'Updated the logo and convention header in pending email previews. Completed decisions remain unchanged; please review the updated previews.')`);
    }
    const templates = await tx.execute<{id: string; body_template: string}>(sql`
      select id, body_template from communication_templates
      where body_format='html' and (strpos(body_template, ${previousLogo}) > 0 or (strpos(body_template, ${EMAIL_LOGO_URL}) > 0 and strpos(body_template, 'data-convention-header="v2"') = 0)) order by id for update
    `);
    for (const template of templates.rows) {
      const body = replaceEmailLogo(template.body_template);
      if (body === template.body_template) continue;
      await tx.execute(sql`update communication_templates set body_template=${body},
        state=case when state='active' then 'reviewed' else state end,
        reviewed_by=null, reviewed_at=null, updated_at=now() where id=${template.id}`);
    }
  });
}


