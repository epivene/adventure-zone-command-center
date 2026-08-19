import { interpretLeadDiscoveryCriteria } from "./lead-scout-criteria";
import { PostgresLeadScoutCrmSearch, type LeadScoutCrmSearch } from "./lead-scout-crm-search";
import { LeadScoutRepository } from "./lead-scout-repository";
import type { LeadDiscoveryInterpretation, LeadScoutRunView } from "./lead-scout-types";

type Interpreter = (question: string, now?: Date) => LeadDiscoveryInterpretation;

type Repository = Pick<
  LeadScoutRepository,
  "createRun" | "getRun" | "getLatestRun" | "setCriteria" | "setCrmReady" | "setFailed"
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
      const run = await this.repository.getRun({ actorId: input.actorId, runId });
      if (!run) throw new Error("LEAD_SCOUT_RUN_NOT_FOUND");
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lead discovery failed";
      await this.repository.setFailed(runId, message).catch(() => undefined);
      throw error;
    }
  }

  async getRun(input: { actorId: string; runId: string }): Promise<LeadScoutRunView> {
    const run = await this.repository.getRun(input);
    if (!run) throw new Error("LEAD_SCOUT_RUN_NOT_FOUND");
    return run;
  }

  async getLatestRun(actorId: string): Promise<LeadScoutRunView | null> {
    return this.repository.getLatestRun(actorId);
  }
}
