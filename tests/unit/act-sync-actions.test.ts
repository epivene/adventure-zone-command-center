import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  createPreview: vi.fn(),
  stage: vi.fn(),
  clearStaged: vi.fn(),
  apply: vi.fn(),
};
const testConnection = vi.fn();

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner" })),
}));
vi.mock("@/features/act-sync/sync-service", () => ({
  ActSyncInterruptedError: class ActSyncInterruptedError extends Error {
    constructor(
      message: string,
      readonly row: {
        rowId: string;
        status: "failed";
        error: string;
        retryable: boolean;
      },
    ) {
      super(message);
    }
  },
  ActSyncQueueChangedError: class ActSyncQueueChangedError extends Error {},
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
  clearActSyncStagedDecisionsAction,
  createActSyncPreviewAction,
  stageActSyncDecisionsAction,
  testActConnectionAction,
} from "@/app/(private)/settings/act-sync/actions";
import { ActSyncInterruptedError } from "@/features/act-sync/sync-service";
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

  it("rejects more than 50 decisions at the authenticated action boundary", async () => {
    const decisions = Array.from({ length: 51 }, (_, index) => ({
      rowId: `row-${index + 1}`,
      decision: "pull" as const,
    }));

    await expect(applyActSyncAction("run-1", decisions)).resolves.toEqual({
      ok: false,
      error: "Apply at most 50 sync decisions at a time.",
    });

    expect(requireOwner).toHaveBeenCalledOnce();
    expect(service.apply).not.toHaveBeenCalled();
  });

  it("durably stages a validated decision batch", async () => {
    service.stage.mockResolvedValue({ runId: "run-1" });
    const decisions = [
      {
        rowId: "row-1",
        decision: "link" as const,
        localContactId: "local-2",
      },
    ];

    await expect(
      stageActSyncDecisionsAction("run-1", decisions),
    ).resolves.toEqual({ ok: true, runId: "run-1" });

    expect(service.stage).toHaveBeenCalledWith(
      "run-1",
      decisions,
      false,
      undefined,
    );
  });

  it("atomically replaces prior staged decisions for the first batch", async () => {
    service.stage.mockResolvedValue({ runId: "run-1" });
    const decisions = [{ rowId: "row-1", decision: "pull" as const }];

    await stageActSyncDecisionsAction("run-1", decisions, true);

    expect(service.stage).toHaveBeenCalledWith(
      "run-1",
      decisions,
      true,
      undefined,
    );
  });

  it("clears a stored recovery queue after owner authorization", async () => {
    service.clearStaged.mockResolvedValue({ runId: "run-1" });

    await expect(
      clearActSyncStagedDecisionsAction("run-1"),
    ).resolves.toEqual({ ok: true, runId: "run-1" });

    expect(requireOwner).toHaveBeenCalledOnce();
    expect(service.clearStaged).toHaveBeenCalledWith("run-1", undefined);
  });

  it("rejects staging more than 50 decisions", async () => {
    const decisions = Array.from({ length: 51 }, (_, index) => ({
      rowId: `row-${index + 1}`,
      decision: "pull" as const,
    }));

    await expect(
      stageActSyncDecisionsAction("run-1", decisions),
    ).resolves.toEqual({
      ok: false,
      error: "Save at most 50 valid sync decisions at a time.",
    });
    expect(service.stage).not.toHaveBeenCalled();
  });

  it("returns sanitized interrupted-row metadata to the batch coordinator", async () => {
    const interruptedRow = {
      rowId: "row-1",
      status: "failed" as const,
      error: "Act! rejected the shared account credentials.",
      retryable: false,
    };
    service.apply.mockRejectedValue(
      new ActSyncInterruptedError(
        "Act! rejected the shared account credentials.",
        interruptedRow,
      ),
    );

    await expect(
      applyActSyncAction("run-1", [
        { rowId: "row-1", decision: "pull" },
      ]),
    ).resolves.toEqual({
      ok: false,
      error: "Act! rejected the shared account credentials.",
      interruptedRow,
    });
  });
});
