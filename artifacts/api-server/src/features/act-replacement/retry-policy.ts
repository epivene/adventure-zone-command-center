const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000;
const MAX_RETRY_AFTER_MS = 15 * 60_000;

const validDate = (value: Date) => Number.isFinite(value.getTime());

export function calculateBackoffMs(attemptCount: number): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("Act retry attempt count is invalid.");
  }
  return Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** (attemptCount - 1));
}

export function parseRetryAfter(value: string | null, now: Date): Date | null {
  if (!value || !validDate(now)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    const parsed = new Date(now.getTime() + seconds * 1_000);
    return Number.isSafeInteger(seconds) && validDate(parsed) ? parsed : null;
  }

  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      trimmed,
    )
  ) {
    return null;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function calculateRetryAt(input: {
  attemptCount: number;
  now: Date;
  retryAfter: Date | null;
}): Date {
  const backoffAt =
    input.now.getTime() + calculateBackoffMs(input.attemptCount);
  const requestedAt =
    input.retryAfter && validDate(input.retryAfter)
      ? input.retryAfter.getTime()
      : Number.NEGATIVE_INFINITY;
  const capAt = input.now.getTime() + MAX_RETRY_AFTER_MS;
  return new Date(Math.min(capAt, Math.max(backoffAt, requestedAt)));
}
