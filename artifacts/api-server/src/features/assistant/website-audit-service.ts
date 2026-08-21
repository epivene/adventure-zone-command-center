import type { AssistantJobView } from "./assistant-job-types";
import { AssistantJobRepository } from "./assistant-job-repository";

export class WebsiteAuditService {
  constructor(private readonly repository: AssistantJobRepository = new AssistantJobRepository()) {}

  async create(input: { actorId: string; instruction: string }): Promise<AssistantJobView> {
    const jobId = await this.repository.createJob({
      actorId: input.actorId,
      instruction: input.instruction,
      normalizedCommand: { cursorAfterId: null },
    });
    const job = await this.repository.getJob({ actorId: input.actorId, jobId });
    if (!job) throw new Error("Assistant audit job could not be loaded after creation.");
    return job;
  }

  get(input: { actorId: string; jobId: string }) {
    return this.repository.getJob(input);
  }

  getLatest(actorId: string) {
    return this.repository.getLatestJob(actorId);
  }

  async requestStop(input: { actorId: string; jobId: string }): Promise<AssistantJobView> {
    const changed = await this.repository.requestStop(input.jobId, input.actorId);
    if (!changed) throw new Error("ASSISTANT_JOB_NOT_STOPPABLE");
    const job = await this.repository.getJob(input);
    if (!job) throw new Error("ASSISTANT_JOB_NOT_FOUND");
    return job;
  }

  async continue(input: { actorId: string; jobId: string }): Promise<AssistantJobView> {
    const changed = await this.repository.continueJob(input.jobId, input.actorId);
    if (!changed) throw new Error("ASSISTANT_JOB_NOT_CONTINUABLE");
    const job = await this.repository.getJob(input);
    if (!job) throw new Error("ASSISTANT_JOB_NOT_FOUND");
    return job;
  }
}
