import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "./computer-calling-rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("allows the configured burst", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });
    const now = new Date("2026-09-01T12:00:00.000Z");

    expect(limiter.take({ key: "owner:127.0.0.1", now })).toBe(true);
    expect(limiter.take({ key: "owner:127.0.0.1", now })).toBe(true);
  });

  it("rejects a request after its window is exhausted", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    const now = new Date("2026-09-01T12:00:00.000Z");

    limiter.take({ key: "owner:127.0.0.1", now });

    expect(limiter.take({ key: "owner:127.0.0.1", now })).toBe(false);
  });

  it("keeps distinct owner and source keys independent", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    const now = new Date("2026-09-01T12:00:00.000Z");

    limiter.take({ key: "owner:127.0.0.1", now });

    expect(limiter.take({ key: "owner:127.0.0.2", now })).toBe(true);
    expect(limiter.take({ key: "another-owner:127.0.0.1", now })).toBe(true);
  });

  it("allows requests again after the window", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1_000 });
    const started = new Date("2026-09-01T12:00:00.000Z");

    limiter.take({ key: "owner:127.0.0.1", now: started });

    expect(limiter.take({
      key: "owner:127.0.0.1",
      now: new Date("2026-09-01T12:00:01.000Z"),
    })).toBe(true);
  });
});
