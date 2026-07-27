import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  createPreview: vi.fn(),
  apply: vi.fn(),
};
const testConnection = vi.fn();

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner" })),
}));
vi.mock("@/features/act-sync/sync-service", () => ({
  createDefaultActSyncService: vi.fn(async () => service),
}));
vi.mock("@/features/act-sync/act-client", () => ({
  ActClient: vi.fn(function ActClient() {
    return { testConnection };
  }),
}));
vi.mock("@/lib/env", () => ({
  getActEnvironment: vi.fn(() => ({
    configured: true,
    config: {
      baseUrl: "https://apius.act.com/act.web.api",
      databaseName: "TEST-ACT-DATABASE",
      username: "shared",
      password: "secret",
    },
  })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  applyActSyncAction,
  createActSyncPreviewAction,
  testActConnectionAction,
} from "@/app/(private)/settings/act-sync/actions";
import { requireOwner } from "@/lib/auth/require-owner";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner" });
});

describe("Act sync actions", () => {
  it("requires the owner before testing the shared connection", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error("Not authorized"));

    await expect(testActConnectionAction()).rejects.toThrow("Not authorized");
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("creates a stored preview after authorization", async () => {
    service.createPreview.mockResolvedValue({ id: "run-1" });

    await expect(createActSyncPreviewAction()).resolves.toEqual({
      ok: true,
      runId: "run-1",
    });
    expect(requireOwner).toHaveBeenCalledOnce();
    expect(service.createPreview).toHaveBeenCalledOnce();
  });

  it("rejects malformed apply decisions without calling the service", async () => {
    await expect(
      applyActSyncAction("run-1", [
        {
          rowId: "row-1",
          decision: "delete_everything" as never,
        },
      ]),
    ).resolves.toEqual({
      ok: false,
      error: "Choose valid sync decisions.",
    });

    expect(service.apply).not.toHaveBeenCalled();
  });
});
