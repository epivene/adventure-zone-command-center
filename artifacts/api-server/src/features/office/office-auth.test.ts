import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLegManagerToken } from "@/features/leg-manager/leg-manager-auth";
import { issueOfficeToken, verifyOfficeToken } from "./office-auth";
import { resolveOfficeSession } from "./office-middleware";

const accountId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  process.env.SESSION_SECRET = "office-auth-test-secret";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T18:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SESSION_SECRET;
});

describe("office authentication token", () => {
  it("round-trips account and session claims", () => {
    const issued = issueOfficeToken({ accountId, sessionVersion: 7 });
    expect(issued).not.toBeNull();
    expect(verifyOfficeToken(issued!.token)).toMatchObject({ accountId, sessionVersion: 7 });
  });

  it("does not parse as a travel-leg manager token", () => {
    const issued = issueOfficeToken({ accountId, sessionVersion: 1 });
    expect(issued).not.toBeNull();
    expect(verifyLegManagerToken(issued!.token)).toBeNull();
  });

  it("rejects tampering and expiry", () => {
    const issued = issueOfficeToken({ accountId, sessionVersion: 2 });
    expect(issued).not.toBeNull();
    expect(verifyOfficeToken(`${issued!.token}x`)).toBeNull();

    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(verifyOfficeToken(issued!.token)).toBeNull();
  });

  it("fails closed when the session secret is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(issueOfficeToken({ accountId, sessionVersion: 1 })).toBeNull();
    expect(verifyOfficeToken("office.anything")).toBeNull();
  });

  it("loads current website-inquiry permission from the account record", async () => {
    const issued = issueOfficeToken({ accountId, sessionVersion: 7 });
    const session = await resolveOfficeSession(issued!.token, {
      getActiveSession: async () => ({
        id: accountId,
        displayName: "Amy",
        role: "office_coordinator",
        enabled: true,
        sessionVersion: 7,
        canReviewWebsiteInquiries: true,
      }),
    });

    expect(session).toMatchObject({
      accountId,
      canReviewWebsiteInquiries: true,
    });
  });
});
