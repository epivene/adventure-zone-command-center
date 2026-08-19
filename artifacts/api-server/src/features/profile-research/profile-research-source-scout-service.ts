import { pool } from "@workspace/db";
import { db } from "@/db/client";
import { ProfileResearchRepository } from "./profile-research-repository";
import { matchRelatedEventsAgainstCrm } from "./profile-research-related-event-matcher";
import { OpenAiSourceScoutProvider, type SourceScoutRequest } from "./profile-research-source-scout";

export type PersistedSourceScout = {
  sourceUrl: string;
  sourceTitle: string | null;
  startDate: string;
  endDate: string;
  scoutedAt: string;
  events: Awaited<ReturnType<typeof matchRelatedEventsAgainstCrm>>;
};

type RunStore = {
  getRun(profileId: string, runId: string): Promise<any | null>;
  updateSummary(profileId: string, runId: string, summary: unknown): Promise<boolean>;
};

type ScoutProvider = {
  scout(input: SourceScoutRequest): Promise<{
    sourceUrl: string;
    sourceTitle: string | null;
    startDate: string;
    endDate: string;
    scoutedAt: string;
    events: any[];
  }>;
};

type CrmMatcher = (events: any[]) => Promise<any[]>;

class DefaultRunStore implements RunStore {
  private readonly runs = new ProfileResearchRepository();

  getRun(profileId: string, runId: string) {
    return this.runs.getRun(profileId, runId);
  }

  async updateSummary(profileId: string, runId: string, summary: unknown) {
    const result = await pool.query(
      `update profile_research_runs
       set summary = $3::jsonb, updated_at = now()
       where id = $2 and profile_id = $1 and status = 'complete'
       returning id`,
      [profileId, runId, JSON.stringify(summary ?? null)],
    );
    return result.rows.length > 0;
  }
}

function scoutKey(value: Pick<PersistedSourceScout, "sourceUrl" | "startDate" | "endDate">) {
  return `${value.sourceUrl}|${value.startDate}|${value.endDate}`;
}

export class ProfileResearchSourceScoutService {
  constructor(
    private readonly runs: RunStore = new DefaultRunStore(),
    private readonly provider: ScoutProvider = new OpenAiSourceScoutProvider(),
    private readonly matchCrm: CrmMatcher = (events) => matchRelatedEventsAgainstCrm(db, events),
  ) {}

  async scout(input: {
    profileId: string;
    runId: string;
    sourceUrl: string;
    sourceTitle?: string | null;
    startDate: string;
    endDate: string;
  }) {
    const run = await this.runs.getRun(input.profileId, input.runId);
    if (!run) throw new Error("PROFILE_RESEARCH_RUN_NOT_FOUND");
    if (run.status !== "complete") throw new Error("PROFILE_RESEARCH_RUN_NOT_READY");

    const result = await this.provider.scout({
      sourceUrl: input.sourceUrl,
      sourceTitle: input.sourceTitle ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    const classified = await this.matchCrm(result.events);
    const scout: PersistedSourceScout = { ...result, events: classified };

    const currentSummary = run.summary && typeof run.summary === "object" ? run.summary as Record<string, unknown> : {};
    const existing = Array.isArray((currentSummary as any).sourceScouts) ? (currentSummary as any).sourceScouts as PersistedSourceScout[] : [];
    const nextScouts = existing.filter((item) => scoutKey(item) !== scoutKey(scout));
    nextScouts.push(scout);
    const nextSummary = { ...currentSummary, sourceScouts: nextScouts };

    const updated = await this.runs.updateSummary(input.profileId, input.runId, nextSummary);
    if (!updated) throw new Error("PROFILE_RESEARCH_RUN_NOT_READY");

    return {
      ...run,
      summary: nextSummary,
    };
  }
}
