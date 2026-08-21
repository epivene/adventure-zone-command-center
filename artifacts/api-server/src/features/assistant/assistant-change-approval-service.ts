import { inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@workspace/db";
import { organizations } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";

export type ApplyProposalBatchResult = {
  requested: number;
  applied: number;
  stale: number;
  failed: number;
  proposalIds: string[];
};

export function normalizeProposalBatchIds(ids: string[]): string[] {
  if (!ids.length) throw new Error("Choose at least one proposal to apply.");
  if (ids.length > 250) throw new Error("No more than 250 proposals can be applied at once.");
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("Duplicate proposal IDs are not allowed.");
  return unique.sort();
}

type Database = typeof defaultDb;

type ProposalRow = {
  id: string;
  recordId: string;
  oldValue: string | null;
  newValue: string | null;
  confidence: "high" | "medium" | "low";
  field: string;
  status: string;
};

function rows<T>(result: unknown): T[] {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? value as T[] : [];
}

export class AssistantChangeApprovalService {
  constructor(private readonly database: Database = defaultDb) {}

  async applyHighConfidenceWebsiteBatch(input: {
    actorId: string;
    jobId: string;
    proposalIds: string[];
  }): Promise<ApplyProposalBatchResult> {
    const proposalIds = normalizeProposalBatchIds(input.proposalIds);

    return this.database.transaction(async (tx) => {
      const idList = sql.join(proposalIds.map((id) => sql`${id}::uuid`), sql`, `);
      const proposalResult = await tx.execute(sql`
        select
          p.id,
          p.record_id as "recordId",
          p.old_value as "oldValue",
          p.new_value as "newValue",
          p.confidence,
          p.field,
          p.status
        from assistant_change_proposals p
        inner join assistant_jobs j on j.id = p.job_id
        where j.id = ${input.jobId}::uuid
          and j.actor_id = ${input.actorId}
          and p.id in (${idList})
        order by p.id
        for update of p
      `);
      const proposals = rows<ProposalRow>(proposalResult);
      if (proposals.length !== proposalIds.length) {
        throw new Error("One or more proposed website fixes are no longer available for this job.");
      }
      if (proposals.some((proposal) =>
        proposal.status !== "proposed"
        || proposal.confidence !== "high"
        || proposal.field !== "website"
        || !proposal.newValue
      )) {
        throw new Error("Only pending high-confidence website proposals can be applied in bulk.");
      }

      const recordIds = [...new Set(proposals.map((proposal) => proposal.recordId))].sort();
      const lockedOrganizations = recordIds.length
        ? await tx.select({ id: organizations.id, website: organizations.website })
            .from(organizations)
            .where(inArray(organizations.id, recordIds))
            .orderBy(organizations.id)
            .for("update")
        : [];
      const websiteById = new Map(lockedOrganizations.map((record) => [record.id, record.website]));

      let applied = 0;
      let stale = 0;
      let failed = 0;

      for (const proposal of proposals) {
        const currentWebsite = websiteById.get(proposal.recordId);
        if (currentWebsite === undefined || currentWebsite !== proposal.oldValue) {
          stale += 1;
          await tx.execute(sql`
            update assistant_change_proposals
            set status='failed', failure_message='Saved website changed after this proposal was created.'
            where id=${proposal.id}::uuid
          `);
          continue;
        }

        try {
          await tx.update(organizations)
            .set({ website: proposal.newValue, updatedAt: new Date() })
            .where(inArray(organizations.id, [proposal.recordId]));
          await tx.execute(sql`
            update assistant_change_proposals
            set status='applied', approved_by=${input.actorId}, approved_at=now(), applied_at=now(), failure_message=null
            where id=${proposal.id}::uuid
          `);
          await recordAuditEntry(tx, {
            entityType: "organization",
            entityId: proposal.recordId,
            action: "assistant_website_fix_applied",
            before: { website: proposal.oldValue },
            after: {
              website: proposal.newValue,
              assistantJobId: input.jobId,
              assistantProposalId: proposal.id,
            },
          });
          applied += 1;
          websiteById.set(proposal.recordId, proposal.newValue);
        } catch (error) {
          failed += 1;
          await tx.execute(sql`
            update assistant_change_proposals
            set status='failed', failure_message=${error instanceof Error ? error.message.slice(0, 500) : "Could not apply website fix."}
            where id=${proposal.id}::uuid
          `);
        }
      }

      return {
        requested: proposalIds.length,
        applied,
        stale,
        failed,
        proposalIds,
      };
    });
  }
}
