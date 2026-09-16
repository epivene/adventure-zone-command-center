import type { OfficeEmailDraftView } from "./office-email-types";

export type ClaimedScheduledEmail = {
  draft: OfficeEmailDraftView;
  sendRequestKey: string;
};

export type ScheduledEmailRepositoryPort = {
  claimOneDue(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<ClaimedScheduledEmail | null>;
  recordClaimedFailure(input: {
    draftId: string;
    workerId: string;
    retryable: boolean;
    nextAttemptAt: Date | null;
    code: string;
    message: string;
  }): Promise<unknown>;
};

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code).slice(0, 120);
  }
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message.slice(0, 120)
    : "OFFICE_EMAIL_DISPATCH_FAILED";
}

export function isRetryableOfficeEmailFailure(code: string): boolean {
  if (code.includes("OUTCOME_UNKNOWN") || code.includes("OUTCOME_UNCERTAIN")) {
    return false;
  }
  return /(?:429|5\d\d|TIMEOUT|RETRYABLE|TOKEN_REQUEST_FAILED)/.test(code);
}

export function officeEmailRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(16, attempt - 1));
  return Math.min(60 * 60 * 1_000, 30_000 * 2 ** exponent);
}

export class OfficeEmailDispatcher {
  constructor(
    private readonly deps: {
      repository: ScheduledEmailRepositoryPort;
      sendClaimed(input: {
        claim: ClaimedScheduledEmail;
        workerId: string;
      }): Promise<void>;
      leaseMs?: number;
    },
  ) {}

  async runOne(input: {
    workerId: string;
    now: Date;
  }): Promise<"sent" | "idle" | "failed"> {
    const claim = await this.deps.repository.claimOneDue({
      workerId: input.workerId,
      now: input.now,
      leaseMs: this.deps.leaseMs ?? 60_000,
    });
    if (!claim) return "idle";
    try {
      await this.deps.sendClaimed({ claim, workerId: input.workerId });
      return "sent";
    } catch (error) {
      const code = failureCode(error);
      const retryable = isRetryableOfficeEmailFailure(code);
      const nextAttemptAt = retryable
        ? new Date(
            input.now.getTime() +
              officeEmailRetryDelayMs(claim.draft.dispatchAttemptCount),
          )
        : null;
      await this.deps.repository.recordClaimedFailure({
        draftId: claim.draft.id,
        workerId: input.workerId,
        retryable,
        nextAttemptAt,
        code,
        message: retryable
          ? "Delivery will retry after a temporary provider failure."
          : "Delivery requires manual review before another attempt.",
      });
      return "failed";
    }
  }
}
