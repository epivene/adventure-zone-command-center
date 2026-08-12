export const APPLY_BATCH_SIZE = 10;
export const MAX_TRANSIENT_APPLY_ATTEMPTS = 3;

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
