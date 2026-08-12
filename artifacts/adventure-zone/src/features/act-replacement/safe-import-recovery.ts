export const APPLY_BATCH_SIZE = 10;
export const MAX_TRANSIENT_APPLY_ATTEMPTS = 3;

type RecoveryInput<Result> = {
  apply: () => Promise<Result>;
  refreshCursor: () => Promise<number>;
  onRefreshedCursor: (cursor: number) => void;
};

function isTransientApplyError(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.message === "Failed to fetch")
  );
}

export async function applyNextWithTransientRecovery<Result>({
  apply,
  refreshCursor,
  onRefreshedCursor,
}: RecoveryInput<Result>): Promise<Result> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_APPLY_ATTEMPTS; attempt += 1) {
    try {
      return await apply();
    } catch (error) {
      if (!isTransientApplyError(error) || attempt === MAX_TRANSIENT_APPLY_ATTEMPTS) {
        throw error;
      }
      onRefreshedCursor(await refreshCursor());
    }
  }
  throw new Error("safe_import_retry_exhausted");
}
