import { interpretLeadDiscoveryCriteria } from "./lead-scout-criteria";
import { PostgresLeadScoutCrmSearch, type LeadScoutCrmSearch } from "./lead-scout-crm-search";
import { LeadScoutRepository } from "./lead-scout-repository";
import {
  PostgresLeadScoutCandidateSaveLinker,
  type LeadScoutCandidateSaveLinker,
} from "./lead-scout-candidate-save-store";
import type {
  LeadDiscoveryInterpretation,
  LeadScoutCandidateView,
  LeadScoutRunView,
} from "./lead-scout-types";
import {
  ResearchProspectIntakeService,
  type ResearchProspectAccepted,
  type ResearchProspectSaveInput,
  type ResearchProspectScoutNote,
} from "@/features/profile-research/research-prospect-intake";

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
  | "queueCandidateDeepen"
  | "dismissCandidate"
  | "setCandidateCrmMatch"
>;

type Intake = Pick<ResearchProspectIntakeService, "create">;

export type LeadScoutClarification = {
  kind: "needs_clarification";
  runId: string;
  message: string;
};

export type LeadScoutCandidateSaveResult =
  | {
      kind: "created";
      profileId: string;
      bookingId: string;
      run: LeadScoutRunView;
    }
  | {
      kind: "duplicate";
      match: Exclude<Awaited<ReturnType<Intake["create"]>>, { kind: "created" }> extends { match: infer Match } ? Match : never;
      run: LeadScoutRunView;
    };

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function candidateScoutSources(
  run: LeadScoutRunView,
  candidate: LeadScoutCandidateView,
): ResearchProspectScoutNote["sources"] {
  const citedSourceIds = new Set(candidate.facts.flatMap((fact) => fact.sourceIds));
  const candidateWebsite = candidate.website?.trim() ?? "";
  const sources = run.sources.filter((source) =>
    citedSourceIds.has(source.id)
    || (candidateWebsite !== "" && source.url === candidateWebsite),
  );
  const byUrl = new Map<string, (typeof sources)[number]>();
  for (const source of sources) byUrl.set(source.url, source);
  return [...byUrl.values()].slice(0, 12).map((source) => ({
    url: source.url,
    title: source.title,
    publisher: source.publisher,
    category: source.category,
    retrievedAt: source.retrievedAt,
  }));
}

function candidateScoutNote(input: {
  run: LeadScoutRunView;
  candidate: LeadScoutCandidateView;
  nextActionKind: ResearchProspectSaveInput["nextActionKind"];
  nextActionDueAt: string;
}): ResearchProspectScoutNote {
  return {
    type: "scout_note",
    version: 1,
    runId: input.run.id,
    candidateId: input.candidate.id,
    createdAt: new Date().toISOString(),
    originalQuestion: input.run.originalQuestion,
    criteriaSummary: input.run.criteriaSummary,
    fitScore: input.candidate.fitScore,
    summary: input.candidate.fitRationale?.trim() || "Scout identified this as a potential booking fit.",
    positives: uniqueText(input.candidate.fitReasons),
    cautions: uniqueText(input.candidate.fitCautions),
    coverageGaps: uniqueText(input.candidate.coverageGaps),
    suggestedNextAction: {
      kind: input.nextActionKind,
      dueAt: input.nextActionDueAt,
    },
    sources: candidateScoutSources(input.run, input.candidate),
  };
}

export class LeadScoutService {
  private readonly repository: Repository;
  private readonly crmSearch: LeadScoutCrmSearch;
  private readonly interpreter: Interpreter;
  private readonly intake: Intake;
  private readonly saveLinker: LeadScoutCandidateSaveLinker;

  constructor(dependencies: {
    repository?: Repository;
    crmSearch?: LeadScoutCrmSearch;
    interpreter?: Interpreter;
    intake?: Intake;
    saveLinker?: LeadScoutCandidateSaveLinker;
  } = {}) {
    this.repository = dependencies.repository ?? new LeadScoutRepository();
    this.crmSearch = dependencies.crmSearch ?? new PostgresLeadScoutCrmSearch();
    this.interpreter = dependencies.interpreter ?? interpretLeadDiscoveryCriteria;
    this.intake = dependencies.intake ?? new ResearchProspectIntakeService();
    this.saveLinker = dependencies.saveLinker ?? new PostgresLeadScoutCandidateSaveLinker();
  }

  async createCrmDiscovery(input: {
    actorId: string;
    question: string;
  }): Promise<LeadScoutRunView | LeadScoutClarification> {
    const question = input.question.trim();
    const runId = await this.repository.createRun({ actorId: input.actorId, question, criteria: null, criteriaSummary: null });
    try {
      const interpretation = this.interpreter(question);
      if (interpretation.kind === "needs_clarification") {
        return { kind: "needs_clarification", runId, message: interpretation.message };
      }
      await this.repository.setCriteria(runId, { criteria: interpretation.criteria, criteriaSummary: interpretation.summary });
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

  async deepenCandidate(input: { actorId: string; runId: string; candidateId: string }): Promise<LeadScoutRunView> {
    await this.requireRun({ actorId: input.actorId, runId: input.runId });
    if (!await this.repository.queueCandidateDeepen(input.runId, input.actorId, input.candidateId)) {
      throw new Error("LEAD_SCOUT_CANDIDATE_NOT_DEEPENABLE");
    }
    return this.requireRun({ actorId: input.actorId, runId: input.runId });
  }

  async dismissCandidate(input: { actorId: string; runId: string; candidateId: string }): Promise<LeadScoutRunView> {
    const current = await this.requireRun({ actorId: input.actorId, runId: input.runId });
    if (current.status === "running" || current.status === "stopping") {
      throw new Error("LEAD_SCOUT_CANDIDATE_NOT_DISMISSIBLE");
    }
    if (!await this.repository.dismissCandidate(input.runId, input.actorId, input.candidateId)) {
      throw new Error("LEAD_SCOUT_CANDIDATE_NOT_DISMISSIBLE");
    }
    return this.requireRun({ actorId: input.actorId, runId: input.runId });
  }

  async saveCandidate(input: {
    actorId: string;
    runId: string;
    candidateId: string;
    accepted: ResearchProspectAccepted;
    nextActionKind: ResearchProspectSaveInput["nextActionKind"];
    nextActionDueAt: string;
  }): Promise<LeadScoutCandidateSaveResult> {
    const current = await this.requireRun({ actorId: input.actorId, runId: input.runId });
    if (current.status === "running" || current.status === "stopping") {
      throw new Error("LEAD_SCOUT_CANDIDATE_NOT_SAVEABLE");
    }
    const candidate = current.candidates.find((item) => item.id === input.candidateId);
    if (
      !candidate ||
      candidate.crmMatchStatus !== "new_prospect" ||
      !["unreviewed", "shortlisted"].includes(candidate.reviewStatus)
    ) {
      throw new Error("LEAD_SCOUT_CANDIDATE_NOT_SAVEABLE");
    }

    const result = await this.intake.create({
      event: {
        name: candidate.name,
        city: candidate.city,
        region: candidate.region,
        startsAt: candidate.startsAt,
        endsAt: candidate.endsAt,
        venue: candidate.venue,
        url: candidate.website ?? input.accepted.website,
        rationale: "Lead Scout prospect approved for CRM intake.",
      },
      accepted: input.accepted,
      nextActionKind: input.nextActionKind,
      nextActionDueAt: input.nextActionDueAt,
      scoutNote: candidateScoutNote({
        run: current,
        candidate,
        nextActionKind: input.nextActionKind,
        nextActionDueAt: input.nextActionDueAt,
      }),
    });

    if (result.kind === "duplicate") {
      await this.repository.setCandidateCrmMatch(input.runId, input.candidateId, result.match);
      return {
        kind: "duplicate",
        match: result.match,
        run: await this.requireRun({ actorId: input.actorId, runId: input.runId }),
      };
    }

    const linked = await this.saveLinker.markSaved({
      runId: input.runId,
      actorId: input.actorId,
      candidateId: input.candidateId,
      profileId: result.profileId,
      bookingId: result.bookingId,
    });
    if (!linked) throw new Error("LEAD_SCOUT_SAVE_LINK_FAILED");

    return {
      kind: "created",
      profileId: result.profileId,
      bookingId: result.bookingId,
      run: await this.requireRun({ actorId: input.actorId, runId: input.runId }),
    };
  }
}