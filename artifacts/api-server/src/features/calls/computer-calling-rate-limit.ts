export interface ComputerCallingRateLimiter {
  take(input: { key: string; now: Date }): boolean;
}

interface FixedWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
}

interface RateLimitWindow {
  startedAtMs: number;
  count: number;
}

export class FixedWindowRateLimiter implements ComputerCallingRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  take(input: { key: string; now: Date }): boolean {
    const nowMs = input.now.getTime();
    const current = this.windows.get(input.key);
    if (!current || nowMs - current.startedAtMs >= this.options.windowMs) {
      this.windows.set(input.key, { startedAtMs: nowMs, count: 1 });
      return true;
    }
    if (current.count >= this.options.limit) return false;
    current.count += 1;
    return true;
  }
}
