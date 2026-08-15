import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hashLegManagerPassword,
  issueLegManagerToken,
  verifyLegManagerPassword,
  verifyLegManagerToken,
} from "./leg-manager-auth";

const originalSecret = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
});

afterEach(() => {
  vi.useRealTimers();
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

describe("leg manager password hashing", () => {
  it("verifies the correct password and rejects the wrong one", async () => {
    const { hash, salt } = await hashLegManagerPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    expect(await verifyLegManagerPassword("correct horse battery staple", hash, salt)).toBe(true);
    expect(await verifyLegManagerPassword("wrong", hash, salt)).toBe(false);
  });

  it("uses a different salt for the same password", async () => {
    const first = await hashLegManagerPassword("same password");
    const second = await hashLegManagerPassword("same password");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });
});

describe("leg manager signed tokens", () => {
  it("preserves the leg id and session version", () => {
    const issued = issueLegManagerToken({
      legId: "00000000-0000-4000-8000-000000000001",
      sessionVersion: 3,
    });
    expect(issued).not.toBeNull();
    expect(verifyLegManagerToken(issued!.token)).toMatchObject({
      legId: "00000000-0000-4000-8000-000000000001",
      sessionVersion: 3,
    });
  });

  it("rejects token tampering", () => {
    const issued = issueLegManagerToken({
      legId: "00000000-0000-4000-8000-000000000001",
      sessionVersion: 1,
    })!;
    const tampered = issued.token.replace("000000000001", "000000000002");
    expect(verifyLegManagerToken(tampered)).toBeNull();
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
    const issued = issueLegManagerToken({
      legId: "00000000-0000-4000-8000-000000000001",
      sessionVersion: 1,
    })!;
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    expect(verifyLegManagerToken(issued.token)).toBeNull();
  });

  it("fails closed without SESSION_SECRET", () => {
    delete process.env.SESSION_SECRET;
    expect(issueLegManagerToken({ legId: "leg-a", sessionVersion: 1 })).toBeNull();
    expect(verifyLegManagerToken("leg.leg-a.1.123.invalid")).toBeNull();
  });
});
