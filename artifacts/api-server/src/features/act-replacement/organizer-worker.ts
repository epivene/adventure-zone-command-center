import type { ActOutcomeRepository } from "./outcome-repository";
import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { buildActOrganizeManifest, type ManifestSourceInput } from "./manifest-builder";

export type OrganizerStepResult = { kind: "idle" } | { kind: "progress"; runId: string; sourceRecordId: string };
export interface OrganizerStore { claimOne(input: { workerId: string; now: Date }): Promise<{ runId: string; source: ManifestSourceInput; sources?: readonly ManifestSourceInput[] } | null>; /** Must be an idempotent upsert keyed by run + operationKey; retries may call it after a process crash. */ saveManifest(runId: string, manifest: ReturnType<typeof buildActOrganizeManifest>): Promise<void>; }

/** Deterministic reference store used by local preview wiring; production adapters must make the same claim atomic in SQL. */
export class InMemoryActOrganizerStore implements OrganizerStore {
  private claimed = new Set<string>();
  readonly manifests = new Map<string, ReturnType<typeof buildActOrganizeManifest>>();
  constructor(private readonly queue: Array<{ runId: string; source: ManifestSourceInput; sources?: readonly ManifestSourceInput[] }>) {}
  async claimOne(_input?: { workerId: string; now: Date }) { const next = this.queue.find((item) => !this.claimed.has(`${item.runId}:${item.source.sourceRecordId}:${item.source.sourceVersionId}`)); if (!next) return null; this.claimed.add(`${next.runId}:${next.source.sourceRecordId}:${next.source.sourceVersionId}`); return next; }
  async saveManifest(runId: string, manifest: ReturnType<typeof buildActOrganizeManifest>) { this.manifests.set(runId, manifest); }
}

type DrizzleDatabase = typeof database;
/** Production adapter: claims the oldest pending outcome with SQL row locking; source loading and manifest persistence stay explicit callbacks. */
export class DrizzleActOrganizerStore implements OrganizerStore {
  constructor(private readonly database: DrizzleDatabase, private readonly loadSources: (runId: string, sourceRecordId: string) => Promise<readonly ManifestSourceInput[]>, private readonly persist: (runId: string, manifest: ReturnType<typeof buildActOrganizeManifest>) => Promise<void>, private readonly leaseMs = 60_000) {}
  async claimOne(input: { workerId: string; now: Date }) {
    const claimed = await this.database.transaction(async (tx) => {
      const result = await tx.execute(sql`select o.run_id as "runId", o.source_record_id as "sourceRecordId", o.source_version_id as "sourceVersionId" from act_replacement_outcomes o join act_replacement_runs r on r.id = o.run_id where r.phase = 'organizing' and (o.state = 'pending' or (o.state = 'leased' and o.lease_expires_at <= ${input.now})) order by o.created_at asc, o.id asc for update of o skip locked limit 1`);
      const row = (result as unknown as { rows: Array<{ runId: string; sourceRecordId: string; sourceVersionId: string }> }).rows[0];
      if (!row) return null;
      await tx.execute(sql`update act_replacement_outcomes set state = 'leased', lease_owner = ${input.workerId}, lease_expires_at = ${new Date(input.now.getTime() + this.leaseMs)}, attempt_count = attempt_count + 1, updated_at = ${input.now} where run_id = ${row.runId} and source_record_id = ${row.sourceRecordId}`);
      return row;
    });
    if (!claimed) return null;
    let sources: readonly ManifestSourceInput[];
    try { sources = await this.loadSources(claimed.runId, claimed.sourceRecordId); } catch (error) { await this.release(claimed, input.now); throw error; }
    const source = sources.find((candidate) => candidate.sourceRecordId === claimed.sourceRecordId);
    if (!source) { await this.release(claimed, input.now); return null; }
    return { runId: claimed.runId, source, sources };
  }
  async saveManifest(runId: string, manifest: ReturnType<typeof buildActOrganizeManifest>) { await this.persist(runId, manifest); }
  private async release(claimed: { runId: string; sourceRecordId: string }, now: Date) { await this.database.execute(sql`update act_replacement_outcomes set state = 'pending', lease_owner = null, lease_expires_at = null, retry_after = ${now}, updated_at = ${now} where run_id = ${claimed.runId} and source_record_id = ${claimed.sourceRecordId} and state = 'leased'`); }
}

export function createActOrganizerWorker(input: { database: DrizzleDatabase; loadSources: (runId: string, sourceRecordId: string) => Promise<readonly ManifestSourceInput[]>; persist: (runId: string, manifest: ReturnType<typeof buildActOrganizeManifest>) => Promise<void>; outcomes: ActOutcomeRepository }) {
  return new ActOrganizerWorker({ store: new DrizzleActOrganizerStore(input.database, input.loadSources, input.persist), outcomes: input.outcomes });
}

/** Durable work adapter. Claiming and persistence belong to the store transaction; this class is process-local only for scheduling. */
export class ActOrganizerWorker {
  constructor(private readonly dependencies: { organizeOne?: () => Promise<OrganizerStepResult>; store?: OrganizerStore; outcomes?: ActOutcomeRepository }) {}
  async runOne(input: { workerId: string; now: Date }): Promise<OrganizerStepResult> {
    if (this.dependencies.organizeOne) return this.dependencies.organizeOne();
    const claimed = await this.dependencies.store?.claimOne(input);
    if (!claimed) return { kind: "idle" };
    const sources = claimed.sources?.length ? claimed.sources : [claimed.source];
    for (const source of sources) await this.dependencies.outcomes?.seed({ runId: claimed.runId, sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "pending", normalized: source.normalized, mappingWarnings: [...(source.warnings ?? [])], unsupportedFieldPaths: [...(source.unsupportedFieldPaths ?? [])] });
    const manifest = buildActOrganizeManifest({ runId: claimed.runId, sources });
    await this.dependencies.store?.saveManifest(claimed.runId, manifest);
    for (const outcome of manifest.outcomes) await this.dependencies.outcomes?.update(claimed.runId, outcome.sourceRecordId, { state: outcome.state, issues: outcome.issues, candidates: outcome.candidates, match: outcome.match, mappingWarnings: outcome.mappingWarnings, unsupportedFieldPaths: outcome.unsupportedFieldPaths, organizedAt: new Date() });
    return { kind: "progress", runId: claimed.runId, sourceRecordId: claimed.source.sourceRecordId };
  }
}
