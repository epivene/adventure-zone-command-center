import { z } from "zod";
import { cleanResearchText, formatResearchNote, validateResearchDates, saveResearchDates, type ResearchDates } from "./research-details";
import { randomUUID } from "node:crypto";
import {
  ConnectionError,
  inputHash,
  requireConnectionScope,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type MutationKey,
  type SourceRef,
  type SqlQuery,
  type OperationReceipt,
} from "./contracts";
import { OperationStore } from "./operation-store";
import { profileRow, profileSummary } from "./read-service";
const httpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  });
export const sourceSchema = z
  .object({
    url: httpUrl,
    retrievedAt: z.string().datetime({ offset: true }),
    eventYear: z.number().int().min(1900).max(2200).nullable(),
    claim: z.string().trim().min(1).max(2000),
    verification: z.enum(["verified", "unverified"]),
  })
  .strict();
export function validateSources(value: unknown): SourceRef[] {
  const parsed = z.array(sourceSchema).min(1).max(20).safeParse(value);
  if (!parsed.success) throw new ConnectionError("CONNECTION_INVALID_SOURCE");
  return parsed.data;
}
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:19|20|21)\d{2}\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function sourceIdentity(s: string) {
  const u = new URL(s);
  u.hash = "";
  u.searchParams.sort();
  return u.href;
}
function website(s: string) {
  const u = new URL(s);
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  return u.host + u.pathname.replace(/\/$/, "");
}
export async function receipt<T>(
  tx: SqlQuery,
  recordId: string,
  href: string,
  revision: string,
  value: T,
): Promise<OperationReceipt<T>> {
  const row = (await tx.query("SELECT now()::text AS saved_at")).rows[0];
  return {
    operationId: randomUUID(),
    recordId,
    href,
    revision,
    savedAt: new Date(row.saved_at).toISOString(),
    value,
  };
}
export async function insertResearchNote(
  tx: SqlQuery,
  profileId: string,
  subject: string,
  body: string,
  sources: SourceRef[],
) {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO activities(id,organization_id,kind,subject,body,occurred_at,timeline_sort_at) VALUES($1,$2,'note',$3,$4,now(),now())",
    [id, profileId, cleanResearchText(subject) || "Event research", formatResearchNote(body, sources)],
  );
  return id;
}
export class LeadNoteService {
  private operations: OperationStore;
  constructor(private db: ConnectionDatabase) {
    this.operations = new OperationStore(db);
  }
  async createLead(
    p: ConnectionPrincipal,
    key: MutationKey,
    raw: {
      name: string;
      city: string;
      region: string;
      officialWebsite: string | null;
      sourceIdentity: string | null;
      eventYear: number | null;
      sources: SourceRef[];
      eventDates?: ResearchDates | null;
      summary?: string;
    },
  ) {
    requireConnectionScope(p, "crm:append");
    const sources = validateSources(raw.sources);
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(300),
        city: z.string().trim().min(1).max(200),
        region: z.string().trim().min(1).max(100),
        officialWebsite: httpUrl.nullable(),
        sourceIdentity: httpUrl.nullable(),
        eventYear: z.number().int().min(1900).max(2200).nullable(),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ConnectionError("CONNECTION_INVALID_LEAD");
    const eventDates = validateResearchDates(raw.eventDates, sources, "eventYear" in raw ? raw.eventYear : undefined);
    const input = { ...parsed.data, sources, ...(raw.eventDates !== undefined ? {eventDates} : {}), ...(raw.summary !== undefined ? {summary: raw.summary.slice(0,2000)} : {}) };
    return this.operations.perform(
      p,
      "create_researched_lead",
      key,
      input,
      async (tx) => {
        // Serializes direct-connection duplicate checks even across different identities/clients.
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtext('chatgpt-connection:lead-creation'))",
        );
        const eventKey = [
          normalize(input.name),
          normalize(input.city),
          normalize(input.region),
        ];
        const identity = input.sourceIdentity
          ? inputHash(["source", sourceIdentity(input.sourceIdentity)])
          : input.officialWebsite
            ? inputHash([
                "website",
                website(input.officialWebsite),
                ...eventKey,
              ])
            : null;
        if (identity) {
          const prior = (
            await tx.query(
              "SELECT profile_id FROM chatgpt_lead_identities WHERE identity_hash=$1",
              [identity],
            )
          ).rows[0];
          if (prior) {
            const result = profileSummary(
              await profileRow(tx, prior.profile_id, true),
            );
            return receipt(tx, result.id, result.href, result.revision, result);
          }
        }
        // Conservative fuzzy name review. Never auto-merge based on a shared city/municipal domain.
        const existing = (
          await tx.query(
            `SELECT *,updated_at::text AS revision FROM organizations WHERE consolidated_into_id IS NULL AND lower(coalesce(city,''))=lower($1) AND lower(coalesce(region,''))=lower($2) ORDER BY name LIMIT 501`,
            [input.city, input.region],
          )
        ).rows;
        const candidates = existing.filter((r) => {
          const n = normalize(r.name),
            target = eventKey[0];
          return n === target || n.includes(target) || target.includes(n);
        });
        if (candidates.length || existing.length > 500) {
          throw new ConnectionError(
            "CONNECTION_DUPLICATE_CANDIDATE",
            409,
            "Review possible existing profiles before creating: " +
              JSON.stringify(candidates.slice(0, 10).map(profileSummary)),
          );
        }
        const id = randomUUID();
        await tx.query(
          "INSERT INTO organizations(id,name,place_type,city,region,website) VALUES($1,$2,'festival_event',$3,$4,$5)",
          [id, input.name, input.city, input.region, input.officialWebsite],
        );
        if (identity)
          await tx.query(
            "INSERT INTO chatgpt_lead_identities(identity_hash,profile_id) VALUES($1,$2)",
            [identity, id],
          );
        await insertResearchNote(
          tx,
          id,
          "Researched lead" + (input.eventYear ? " — " + input.eventYear : ""),
          input.summary || sources.slice(0,3).map(s => (s.verification === "unverified" ? "Unverified: " : "") + s.claim.slice(0,400)).join("\n"),
          sources,
        );
        await saveResearchDates(tx, id, eventDates, sources);
        const result = profileSummary(await profileRow(tx, id));
        return receipt(tx, id, result.href, result.revision, result);
      },
    );
  }
  async appendNote(
    p: ConnectionPrincipal,
    key: MutationKey,
    raw: {
      profileId: string;
      subject: string;
      body: string;
      sources: SourceRef[];
      eventDates?: ResearchDates | null;
      summary?: string;
    },
  ) {
    requireConnectionScope(p, "crm:append");
    const sources = validateSources(raw.sources);
    const parsed = z
      .object({
        profileId: z.string().uuid(),
        subject: z.string().trim().min(1).max(300),
        body: z.string().trim().min(1).max(20000),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ConnectionError("CONNECTION_INVALID_NOTE");
    const eventDates = validateResearchDates(raw.eventDates, sources, "eventYear" in raw ? raw.eventYear : undefined);
    const input = { ...parsed.data, sources, ...(raw.eventDates !== undefined ? {eventDates} : {}), ...(raw.summary !== undefined ? {summary: raw.summary.slice(0,2000)} : {}) };
    return this.operations.perform(
      p,
      "append_research_note",
      key,
      input,
      async (tx) => {
        await profileRow(tx, input.profileId, true);
        const id = await insertResearchNote(
          tx,
          input.profileId,
          input.subject,
          input.body,
          sources,
        );
        const dateFact = await saveResearchDates(tx, input.profileId, eventDates, sources);
        return receipt(tx, id, `/profiles/${input.profileId}`, id, {
          dateFact,
          noteId: id,
        });
      },
    );
  }
}
