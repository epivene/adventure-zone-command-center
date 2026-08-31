import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { issueLegManagerToken } from "@/features/leg-manager/leg-manager-auth";
import { issueOfficeToken } from "@/features/office/office-auth";
import { issueOwnerToken, verifyOwnerToken } from "./owner-token";

const previousSecret = process.env.SESSION_SECRET;
const ownerId = "30000000-0000-4000-8000-000000000001";

beforeEach(() => {
  process.env.SESSION_SECRET = "owner-token-test-secret";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

describe("owner tokens", () => {
  it("binds a signed token to one owner ID, session version, and expiry", () => {
    const issuedAt = Date.UTC(2026, 7, 31, 18, 0, 0);
    const issued = issueOwnerToken({ ownerId, sessionVersion: 7 }, issuedAt);

    expect(issued).not.toBeNull();
    expect(issued!.token).toMatch(/^owner\./);
    expect(verifyOwnerToken(issued!.token, issuedAt + 1)).toEqual({
      ownerId,
      sessionVersion: 7,
      expiresAtMs: new Date(issued!.expiresAt).getTime(),
    });
    expect(verifyOwnerToken(issued!.token, new Date(issued!.expiresAt).getTime())).toBeNull();
  });

  it("rejects tampered, Office, leg-manager, malformed, and invalid-identity tokens", () => {
    const owner = issueOwnerToken({ ownerId, sessionVersion: 7 })!;
    const office = issueOfficeToken({
      accountId: "10000000-0000-4000-8000-000000000001",
      sessionVersion: 1,
    })!;
    const manager = issueLegManagerToken({
      legId: "20000000-0000-4000-8000-000000000001",
      sessionVersion: 1,
    })!;

    expect(verifyOwnerToken(owner.token.replace(".7.", ".8."))).toBeNull();
    expect(verifyOwnerToken(office.token)).toBeNull();
    expect(verifyOwnerToken(manager.token)).toBeNull();
    expect(verifyOwnerToken("owner.not-a-token")).toBeNull();
    expect(issueOwnerToken({ ownerId: "not-a-uuid", sessionVersion: 1 })).toBeNull();
    expect(issueOwnerToken({ ownerId, sessionVersion: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
  });

  it("fails closed when SESSION_SECRET is unavailable", () => {
    delete process.env.SESSION_SECRET;
    expect(issueOwnerToken({ ownerId, sessionVersion: 1 })).toBeNull();
    expect(verifyOwnerToken("owner.anything")).toBeNull();
  });
});
