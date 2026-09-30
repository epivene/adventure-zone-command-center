import { z } from "zod";
import { ConnectionError, type SourceRef, type SqlQuery } from "./contracts";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
 const parsed = new Date(value + "T12:00:00Z");
 return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "Use a real calendar date");
export const eventDatesSchema = z.object({
 startsOn: date, endsOn: date.nullable(), status: z.enum(["confirmed", "expected"]),
 sourceUrl: z.string().url(), rationale: z.string().trim().min(10).max(1500),
}).strict().refine(v => !v.endsOn || v.endsOn >= v.startsOn, "End date precedes start date");
export type ResearchDates = z.infer<typeof eventDatesSchema>;
export function cleanResearchText(value: string) {
 return value.split(/\n/).filter(line => !/chatgpt|openai|direct.*connection/i.test(line)).join("\n").trim();
}
export function formatResearchNote(body: string, sources: SourceRef[]) {
 const text = cleanResearchText(body);
 return text + "\n\nSources:\n" + [...new Set(sources.map(s => `${s.url}${s.verification === "unverified" ? " (unverified)" : ""}`))].join("\n");
}
export function validateResearchDates(raw: unknown, sources: SourceRef[], year?: number | null): ResearchDates | null {
 if (raw == null) return null;
 const parsed = eventDatesSchema.safeParse(raw);
 if (!parsed.success) throw new ConnectionError("CONNECTION_INVALID_EVENT_DATES");
 const value = parsed.data;
 const source = sources.find(s => s.url === value.sourceUrl && (value.status !== "confirmed" || s.verification === "verified"));
 if (!source || (year != null && Number(value.startsOn.slice(0,4)) !== year) || (value.status === "confirmed" && source.eventYear !== Number(value.startsOn.slice(0,4)))) throw new ConnectionError("CONNECTION_INVALID_EVENT_DATE_SOURCE");
 return value;
}
export async function saveResearchDates(tx: SqlQuery, profileId: string, value: ResearchDates | null, sources: SourceRef[]) {
 if (!value) return null;
 // All writers using this connection serialize through the organization row.
 await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [profileId]);
 const active = (await tx.query("SELECT *,starts_on::text AS starts_on,ends_on::text AS ends_on FROM event_date_facts WHERE organization_id=$1 AND active=true FOR UPDATE", [profileId])).rows[0];
 if (active && String(active.starts_on).slice(0,10) === value.startsOn && (active.ends_on == null ? null : String(active.ends_on).slice(0,10)) === value.endsOn && active.status === value.status) return {id:active.id,status:active.status};
 const source = sources.find(s => s.url === value.sourceUrl)!;
 const status = active ? "needs_review" : value.status;
 const result = await tx.query(`INSERT INTO event_date_facts(organization_id,starts_on,ends_on,status,rationale,source_kind,source_title,source_url,researched_at,verified_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status`, [profileId,value.startsOn,value.endsOn,status,cleanResearchText(value.rationale)+(active ? "\nConflicts with an existing date; review required." : ""),value.status === "expected" ? "derived" : "web", "Event website",value.sourceUrl,source.retrievedAt,value.status === "confirmed" ? source.retrievedAt : null,!active]);
 return result.rows[0];
}
