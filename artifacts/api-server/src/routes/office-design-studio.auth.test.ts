import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, resolveOfficeSession, verifyBossToken, verifyToken } = vi.hoisted(() => ({
  db: { select: vi.fn(), insert: vi.fn() },
  resolveOfficeSession: vi.fn(),
  verifyBossToken: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db }));
vi.mock("@/features/office/office-middleware", () => ({ resolveOfficeSession }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class {},
}));
vi.mock("@/features/boss/boss-auth", () => ({ verifyBossToken }));
vi.mock("@/features/boss/boss-account-repository", () => ({
  DrizzleBossAccountRepository: class {},
}));
vi.mock("@/lib/auth", () => ({ verifyToken }));
vi.mock("@/lib/private-object-storage", () => ({
  GoogleCloudPrivateObjectStorage: class {},
}));

import { requireStudio } from "./office-design-studio";

function selectResult(rows: unknown[]) {
  const query: Record<string, unknown> = {};
  query.from = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(async () => rows);
  return query;
}

describe("Design Studio owner authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOfficeSession.mockResolvedValue(null);
    verifyBossToken.mockReturnValue(null);
    verifyToken.mockReturnValue(true);
  });

  it("creates a private Studio identity when the owner has no Office account", async () => {
    const ownerAccount = { id: "0f17d4fb-b04f-4dda-907c-494b1aeb8881", displayName: "Adventure Zone Owner" };
    db.select.mockReturnValue(selectResult([]));
    db.insert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => [ownerAccount]),
        })),
      })),
    });
    const req = { headers: { authorization: "Bearer valid-owner-token" } } as any;
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;
    const next = vi.fn();

    await requireStudio(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.officeAccount).toEqual({
      accountId: ownerAccount.id,
      displayName: "Adventure Zone Owner",
      role: "office_coordinator",
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
