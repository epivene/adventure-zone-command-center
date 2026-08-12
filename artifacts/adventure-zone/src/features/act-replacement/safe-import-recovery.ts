export const APPLY_BATCH_SIZE = 10;
export const MAX_TRANSIENT_APPLY_ATTEMPTS = 3;
const MAX_CONSECUTIVE_CURSOR_REPLAYS = 3;

type CursorProgress = {
  cursor: number;
  consecutiveReplays: number;
};

export function trackApplyCursorProgress(input: {
  previousCursor: number | null;
  nextCursor: number;
  consecutiveReplays: number;
}): CursorProgress {
  if (
    input.previousCursor !== null &&
    input.nextCursor <= input.previousCursor
  ) {
    const consecutiveReplays = input.consecutiveReplays + 1;
    if (
      input.nextCursor < input.previousCursor ||
      consecutiveReplays >= MAX_CONSECUTIVE_CURSOR_REPLAYS
    ) {
      throw new Error("apply_cursor_stalled");
    }
    return { cursor: input.nextCursor, consecutiveReplays };
  }
  return { cursor: input.nextCursor, consecutiveReplays: 0 };
}

export function shouldReuseSafeImportApproval(input: {
  phase: string;
  retryFailed: boolean;
}) {
  return input.phase === "applying" && !input.retryFailed;
}

export function safeImportApprovalRequestKey(input: {
  runId: string;
  manifestDigest: string;
  retryFailed: boolean;
}) {
  return [
    "act-safe",
    input.runId,
    input.manifestDigest,
    input.retryFailed ? "retry" : "apply",
  ].join("-");
}

type RecoveryInput<Result> = {
  apply: () => Promise<Result>;
  refreshState: () => Promise<{ done: boolean }>;
};

function isTransientApplyError(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.message === "Failed to fetch")
  );
}

export async function applyNextWithTransientRecovery<Result>({
  apply,
  refreshState,
}: RecoveryInput<Result>): Promise<Result | null> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_APPLY_ATTEMPTS; attempt += 1) {
    try {
      return await apply();
    } catch (error) {
      if (
        !isTransientApplyError(error) ||
        attempt === MAX_TRANSIENT_APPLY_ATTEMPTS
      ) {
        throw error;
      }
      const refreshed = await refreshState();
      if (refreshed.done) return null;
    }
  }
  throw new Error("safe_import_retry_exhausted");
}
