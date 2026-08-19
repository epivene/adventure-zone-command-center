import { interpretLeadDiscoveryCriteria } from "./lead-scout-criteria";
import { PostgresLeadScoutCrmSearch, type LeadScoutCrmSearch } from "./lead-scout-crm-search";
import { LeadScoutRepository } from "./lead-scout-repository";
import type { LeadDiscoveryInterpretation, LeadScoutRunView } from "./lead-scout-types";

type Interpreter = (question: string, now?: Date) => LeadDiscoveryInterpretation;

type Repository = Pick<
  LeadScoutRepository,
  | "createRun"
  | "getRun"
  | "getLatestRun"
  | "setCriteria"
  | "setCrmReady"
  | "setFailed"
  | "startWeb"
  | "requestStop"
  | "continueWeb"
>;

export type LeadScoutClarification = {
  kind: "needs_clarification";
  runId: string;
  message: string;
};

export class LeadScoutService {
  private readonly repository: Repository;
  private readonly crmSearch: LeadScoutCrmSearch;
  private readonly interpreter: Interpreter;

  constructor(dependencies: {
    repository?: Repository;
    crmSearch?: LeadScoutCrmSearch;
    interpreter?: Interpreter;
  } = {}) {
    this.repository = dependencies.repository ?? new LeadScoutRepository();
    this.crmSearch = dependencies.crmSearch ?? new PostgresLeadScoutCrmSearch();
    this.interpreter = dependencies.interpreter ?? interpretLeadDiscoveryCriteria;
  }

  async createCrmDiscovery(input: {
    actorId: string;
    question: string;
  }): Promise<LeadScoutRunView | LeadScoutClarification> {
    const question = input.question.trim();
    const runId = await this.repository.createRun({
      actorId: input.actorId,
      question,
      criteria: null,
      criteriaSummary: null,
    });

    try {
      const interpretation = this.interpreter(question);
      if (interpretation.kind === "needs_clarification") {
        return {
          kind: "needs_clarification",
          runId,
          message: interpretation.message,
        };
      }

      await this.repository.setCriteria(runId, {
        criteria: interpretation.criteria,
        criteriaSummary: interpretation.summary,
      });
      const matches = await this.crmSearch.search(interpretation.criteria, 10);
      await this.repository.setCrmReady(runId, matches);
      return await this.requireRun({ actorId: input.actorId, runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lead discovery failed";
      await this.repository.setFailed(runId, message).catch(() => undefined);
      throw error;
    }
  }

  private async requireRun(input: { actorId: string; runId: string }): Promise<LeadScoutRunView> {
    const run = await this.repository.getRun(input);
    if (!run) throw new Error("LEAD_SCOUT_RUN_NOT_FOUND");
    return run;
  }

  async getRun(input: { actorId: string; runId: string }): Promise<LeadScoutRunView> {
    return this.requireRun(input);
  }

  async getLatestRun(actorId: string): Promise<LeadScoutRunView | null> {
    return this.repository.getLatestRun(actorId);
  }

  async startWeb(input: { actorId: string; runId: string }): Promise<LeadScoutRunView> {
    const current = await this.requireRun(input);
    if (current.status === "running") return current;
    if (current.status !== "crm_ready") throw new Error("LEAD_SCOUT_INVALID_STATE");
    if (!await this.repository.startWeb(input.runId, input.actorId)) {
      const latest = await this.requireRun(input);
      if (latest.status === "running") return latest;
      throw new Error("LEAD_SCOUT_INVALID_STATE");
    }
    return this.requireRun(input);
  }

  async stopWeb(input: { actorId: string; runId: string }): Promise<LeadScoutRunView> {
    const current = await this.requireRun(input);
    if (current.status === "stopping" || current.status === "stopped") return current;
    if (current.status !== "running") throw new Error("LEAD_SCOUT_INVALID_STATE");
    if (!await this.repository.requestStop(input.runId, input.actorId)) {
      const latest = await this.requireRun(input);
      if (latest.status === "stopping" || latest.status === "stopped") return latest;
      throw new Error("LEAD_SCOUT_INVALID_STATE");
    }
    return this.requireRun(input);
  }

  async continueWeb(input: { actorId: string; runId: string }): Promise<LeadScoutRunView> {
    const current = await this.requireRun(input);
    if (current.status === "running") return current;
    if (current.status !== "stopped") throw new Error("LEAD_SCOUT_INVALID_STATE");
    if (!await this.repository.continueWeb(input.runId, input.actorId)) {
      const latest = await this.requireRun(input);
      if (latest.status === "running") return latest;
      throw new Error("LEAD_SCOUT_INVALID_STATE");
    }
    return this.requireRun(input);
  }
}
