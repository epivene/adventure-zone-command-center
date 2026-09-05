import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueBossToken, verifyBossToken } from "./boss-auth";

const originalSecret = process.env.SESSION_SECRET;
beforeEach(() => { process.env.SESSION_SECRET = "boss-test-secret"; });
afterEach(() => { vi.useRealTimers(); if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret; });

describe("Boss tokens", () => {
  it("are role-distinct, signed, and retain session version", () => {
    const issued = issueBossToken({ accountId: "00000000-0000-4000-8000-000000000037", sessionVersion: 4 })!;
    expect(issued.token.startsWith("boss.")).toBe(true);
    expect(verifyBossToken(issued.token)).toEqual({ accountId: "00000000-0000-4000-8000-000000000037", sessionVersion: 4 });
    expect(verifyBossToken(issued.token.replace("000000000037", "000000000038"))).toBeNull();
  });
  it("expires tokens and fails closed with no signing secret", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const issued = issueBossToken({ accountId: "account", sessionVersion: 1 })!;
    vi.setSystemTime(new Date("2026-02-02T00:00:00Z"));
    expect(verifyBossToken(issued.token)).toBeNull();
    delete process.env.SESSION_SECRET;
    expect(issueBossToken({ accountId: "account", sessionVersion: 1 })).toBeNull();
  });
});