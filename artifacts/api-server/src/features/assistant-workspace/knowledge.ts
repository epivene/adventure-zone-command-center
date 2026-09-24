import { z } from "zod";
import type { Queryable } from "./contracts";
export function shouldApplySeed(input: {
  currentVersion: number;
  incomingVersion: number;
  userEdited: boolean;
}) {
  return !input.userEdited && input.incomingVersion > input.currentVersion;
}
const proposalSchema = z
  .object({
    ruleKey: z.string().min(1).max(120),
    body: z.string().min(1).max(12000),
    sourceLabel: z.string().min(1).max(1000),
    organizationId: z.string().uuid().nullable(),
    eventYear: z.number().int().min(2000).max(2200).nullable(),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
  })
  .strict()
  .refine((x) => !x.effectiveTo || x.effectiveTo >= x.effectiveFrom);
export type RuleProposal = z.infer<typeof proposalSchema>;
export interface Rule extends RuleProposal {
  id: string;
  version: number | null;
  status: string;
  supersedesId: string | null;
  approvedBy: string | null;
  reviewedAt: string | null;
}
export function ruleDate(value: string | Date): string {
  if (!(value instanceof Date)) return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function map(r: any): Rule {
  return {
    id: r.id,
    ruleKey: r.rule_key,
    body: r.body,
    sourceLabel: r.source_label,
    organizationId: r.organization_id,
    eventYear: r.event_year,
    effectiveFrom: ruleDate(r.effective_from),
    effectiveTo: r.effective_to ? ruleDate(r.effective_to) : null,
    version: r.version,
    status: r.status,
    supersedesId: r.supersedes_id,
    approvedBy: r.approved_by,
    reviewedAt: r.reviewed_at,
  };
}
export class KnowledgeRepository {
  constructor(private readonly db: Queryable) {}
  async propose(actorId: string, raw: RuleProposal): Promise<Rule> {
    const p = proposalSchema.parse(raw);
    if (!actorId) throw new Error("ASSISTANT_ACCESS_DENIED");
    const scope = JSON.stringify([p.ruleKey, p.organizationId, p.eventYear]);
    const r = await this.db.query(
      `WITH head AS (INSERT INTO assistant_workspace_rule_heads(scope_key) VALUES($1) ON CONFLICT(scope_key) DO UPDATE SET scope_key=excluded.scope_key RETURNING scope_key)
   INSERT INTO assistant_workspace_rules(scope_key,rule_key,body,source_label,organization_id,event_year,effective_from,effective_to,proposed_by)
   SELECT scope_key,$2,$3,$4,$5,$6,$7,$8,$9 FROM head RETURNING *`,
      [
        scope,
        p.ruleKey,
        p.body,
        p.sourceLabel,
        p.organizationId,
        p.eventYear,
        p.effectiveFrom,
        p.effectiveTo,
        actorId,
      ],
    );
    return map(r.rows[0]);
  }
  async approve(
    actorId: string,
    id: string,
    expectedVersion: number,
  ): Promise<Rule> {
    if (!actorId || !Number.isInteger(expectedVersion) || expectedVersion < 0)
      throw new Error("ASSISTANT_ACCESS_DENIED");
    const r = await this.db.query(
      `WITH candidate AS (SELECT * FROM assistant_workspace_rules WHERE id=$1 AND status='proposed'),
   advanced AS (UPDATE assistant_workspace_rule_heads h SET version=h.version+1,current_id=c.id FROM candidate c WHERE h.scope_key=c.scope_key AND h.version=$2 RETURNING h.version,c.id,c.scope_key),
   retired AS (UPDATE assistant_workspace_rules r SET status='superseded' FROM advanced a WHERE r.scope_key=a.scope_key AND r.status='approved' RETURNING r.id),
   approved AS (UPDATE assistant_workspace_rules r SET status='approved',version=a.version,approved_by=$3,reviewed_at=now(),supersedes_id=(SELECT id FROM retired LIMIT 1) FROM advanced a WHERE r.id=a.id RETURNING r.*)
   SELECT * FROM approved`,
      [id, expectedVersion, actorId],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_RULE_VERSION_CONFLICT");
    return map(r.rows[0]);
  }
  async list(input: {
    organizationId: string | null;
    eventYear: number | null;
    at: string;
  }): Promise<Rule[]> {
    const r = await this.db.query(
      `SELECT * FROM assistant_workspace_rules WHERE status='approved' AND (organization_id IS NULL OR organization_id=$1) AND (event_year IS NULL OR event_year=$2) AND effective_from<=$3::date AND (effective_to IS NULL OR effective_to>=$3::date) ORDER BY rule_key,organization_id NULLS FIRST,event_year NULLS FIRST`,
      [input.organizationId, input.eventYear, input.at],
    );
    return r.rows.map(map);
  }
  async history(): Promise<Rule[]> {
    return (
      await this.db.query(
        `SELECT * FROM assistant_workspace_rules ORDER BY created_at,id`,
      )
    ).rows.map(map);
  }
}
