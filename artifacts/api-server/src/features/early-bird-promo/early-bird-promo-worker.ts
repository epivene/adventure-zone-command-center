import type { EarlyBirdPromoRepository } from "./early-bird-promo-repository";

export class EarlyBirdPromoWorker {
  constructor(private readonly repository: Pick<
    EarlyBirdPromoRepository,
    "expireDue" | "claimOneReminder" | "createReminderArtifacts" | "releaseReminderClaim"
  >) {}

  async runOne(input: {
    workerId: string;
    now: Date;
  }): Promise<{ kind: "idle" } | { kind: "progress"; enrollmentId: string }> {
    await this.repository.expireDue(input.now);
    const enrollment = await this.repository.claimOneReminder(input);
    if (!enrollment) return { kind: "idle" };
    try {
      await this.repository.createReminderArtifacts({
        enrollmentId: enrollment.id,
        workerId: input.workerId,
        now: input.now,
      });
      return { kind: "progress", enrollmentId: enrollment.id };
    } catch (error) {
      await this.repository.releaseReminderClaim({
        enrollmentId: enrollment.id,
        workerId: input.workerId,
        now: input.now,
      });
      throw error;
    }
  }
}
