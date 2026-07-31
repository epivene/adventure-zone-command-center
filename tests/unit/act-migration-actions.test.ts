import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: {
    start: vi.fn(),
    captureNext: vi.fn(),
  },
  preview: {
    finalizePreview: vi.fn(),
    saveDecision: vi.fn(),
  },
  createCapture: vi.fn(),
  createPreview: vi.fn(),
  getActEnvironment: vi.fn(),
  requireOwner: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/env", () => ({
  getActEnvironment: mocks.getActEnvironment,
}));
vi.mock("@/features/act-migration/runtime", () => ({
  createActMigrationCaptureService: mocks.createCapture,
  createActMigrationPreviewService: mocks.createPreview,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import {
  continueActMigrationAction,
  finalizeActMigrationPreviewAction,
  resumeActMigrationAction,
  saveActMigrationDecisionAction,
  startActMigrationAction,
} from "@/app/(private)/settings/act-migration/actions";
import * as actMigrationActions from "@/app/(private)/settings/act-migration/actions";
import {
  ActMigrationLeaseConflictError,
  ActMigrationRunConflictError,
  ActMigrationRunNotFoundError,
} from "@/features/act-migration/snapshot-repository";
import { ActApiError } from "@/features/act-sync/act-errors";

const runId = "11111111-1111-4111-8111-111111111111";
const requestKey = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const progress = {
  runId,
  status: "snapshotting" as const,
  completedCheckpoints: 0,
  totalCheckpoints: 8,
  stagedRecords: 0,
  failedCheckpoints: 0,
  retryable: false,
  retryAfter: null,
  streams: [],
  interruption: null,
};
const preview = {
  runId,
  rows: [],
  report: {
    runId,
    sourceDigest: "source",
    proposalDigest: "proposal",
    proposalCount: 0,
    stateCounts: {},
    targetCounts: {},
    issueCounts: {},
    dependencyOrder: [],
  },
  page: 1,
  pageSize: 50,
  total: 0,
  entityCounts: {
    organization: 0,
    contact: 0,
    organization_contact: 0,
    booking: 0,
    booking_contact: 0,
    calling_list: 0,
    calling_list_member: 0,
  },
  stateCounts: {
    new: 0,
    matched_unchanged: 0,
    change: 0,
    new_relationship: 0,
    possible_duplicate: 0,
    needs_review: 0,
    ignored: 0,
    error: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwner.mockResolvedValue({ userId: "owner-user" });
  mocks.getActEnvironment.mockReturnValue({
    configured: true,
    config: {
      baseUrl: "https://apius.act.com/act.web.api",
      databaseName: "  Safe Name  ",
      username: "shared-user",
      password: "shared-password",
    },
  });
  mocks.createCapture.mockResolvedValue(mocks.capture);
  mocks.createPreview.mockResolvedValue(mocks.preview);
});

describe("Act migration owner actions", () => {
  it("exports only server-action functions at runtime", () => {
    expect(
      Object.entries(actMigrationActions)
        .filter(([, value]) => typeof value !== "function")
        .map(([name]) => name),
    ).toEqual([]);
  });

  it.each([
    ["start", () => startActMigrationAction("invalid-request-key")],
    ["continue", () => continueActMigrationAction("invalid-run-id")],
    ["resume", () => resumeActMigrationAction("invalid-run-id")],
    [
      "finalize",
      () => finalizeActMigrationPreviewAction({
        runId: "invalid-run-id",
        query: { page: 0, pageSize: 101 },
      }),
    ],
    [
      "decision",
      () => saveActMigrationDecisionAction({
        runId: "invalid-run-id",
        proposalKey: " ",
        decision: "invalid" as never,
      }),
    ],
  ])("authorizes before parsing or constructing the %s runtime", async (
    _name,
    invoke,
  ) => {
    mocks.requireOwner.mockRejectedValueOnce(new Error("Not authorized"));

    await expect(invoke()).rejects.toThrow("Not authorized");
    expect(mocks.requireOwner).toHaveBeenCalledOnce();
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
    expect(mocks.createCapture).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.capture.start).not.toHaveBeenCalled();
    expect(mocks.capture.captureNext).not.toHaveBeenCalled();
    expect(mocks.preview.finalizePreview).not.toHaveBeenCalled();
    expect(mocks.preview.saveDecision).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("starts with only the database digest and owner identity", async () => {
    mocks.capture.start.mockResolvedValue({
      id: runId,
      created: true,
      progress,
    });

    await expect(startActMigrationAction(requestKey)).resolves.toEqual({
      ok: true,
      changed: true,
      runId,
      progress,
    });
    expect(mocks.capture.start).toHaveBeenCalledWith({
      requestKey,
      sourceDatabaseKey:
        "4791279b7698564603845eeb4993df884a82469470d11c282ea16f19a098bdeb",
      requestedBy: "owner-user",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/settings/act-migration",
    );
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "returns an interrupted start retry with created=%s and revalidate=%s",
    async (created, revalidate) => {
      mocks.capture.start.mockResolvedValue({
        id: runId,
        created,
        progress: {
          ...progress,
          failedCheckpoints: 2,
          retryable: true,
          retryAfter: new Date("2030-01-02T03:04:05.000Z"),
          interruption: {
            code: "authentication_failed",
            retryable: false,
            retryAfter: null,
          },
        },
      });

      await expect(startActMigrationAction(requestKey)).resolves.toEqual({
        ok: false,
        error:
          "Act! rejected the shared account credentials. Check the Render settings.",
        retryable: false,
        retryAfter: null,
      });
      expect(mocks.revalidatePath).toHaveBeenCalledTimes(revalidate ? 1 : 0);
    },
  );

  it("validates strict identifiers before factory construction", async () => {
    await expect(continueActMigrationAction("run-1")).resolves.toMatchObject({
      ok: false,
      retryable: false,
      retryAfter: null,
    });
    await expect(
      finalizeActMigrationPreviewAction({
        runId,
        query: { page: 0, pageSize: 101 },
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      saveActMigrationDecisionAction({
        runId,
        proposalKey: " ",
        decision: "link_existing",
        chosenLocalEntityId: candidateId,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(mocks.createCapture).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
  });

  it("rejects out-of-range pages, filters, decisions, IDs, and bounded text", async () => {
    const invalidPreviewQueries = [
      { page: 1_000_001, pageSize: 50 },
      { page: 1, pageSize: 0 },
      { page: 1, pageSize: 50, state: "unsafe" as never },
      { page: 1, pageSize: 50, targetEntityType: "unsafe" as never },
    ];
    for (const query of invalidPreviewQueries) {
      await expect(finalizeActMigrationPreviewAction({
        runId,
        query,
      })).resolves.toMatchObject({ ok: false });
    }
    const invalidDecisions = [
      { proposalKey: "p".repeat(501), decision: "ignore" as const },
      { proposalKey: "p", decision: "unsafe" as never },
      {
        proposalKey: "p",
        decision: "link_existing" as const,
        chosenLocalEntityId: "not-a-uuid",
      },
      {
        proposalKey: "p",
        decision: "ignore" as const,
        primarySourceId: "s".repeat(501),
      },
      {
        proposalKey: "p",
        decision: "ignore" as const,
        ignoreReason: "r".repeat(2_001),
      },
    ];
    for (const input of invalidDecisions) {
      await expect(saveActMigrationDecisionAction({
        runId,
        ...input,
      })).resolves.toMatchObject({ ok: false });
    }
    expect(mocks.createPreview).not.toHaveBeenCalled();
  });

  it.each([
    ["continue", continueActMigrationAction],
    ["resume", resumeActMigrationAction],
  ])("%s captures exactly one bounded page", async (_name, action) => {
    mocks.capture.captureNext.mockResolvedValue({
      changed: true,
      progress,
    });

    await expect(action(runId)).resolves.toEqual({
      ok: true,
      changed: true,
      runId,
      progress,
    });
    expect(mocks.capture.captureNext).toHaveBeenCalledOnce();
    expect(mocks.capture.captureNext).toHaveBeenCalledWith(runId, {
      maxRequests: 10,
    });
  });

  it("returns a persisted interruption as a safe action error and revalidates", async () => {
    mocks.capture.captureNext.mockResolvedValue({
      changed: true,
      progress: {
        ...progress,
        failedCheckpoints: 1,
        retryable: true,
        retryAfter: new Date("2030-01-02T03:04:05.000Z"),
        interruption: {
          code: "rate_limited",
          retryable: true,
          retryAfter: new Date("2030-01-02T03:04:05.000Z"),
        },
      },
    });

    await expect(continueActMigrationAction(runId)).resolves.toEqual({
      ok: false,
      error: "Act! is temporarily rate limiting requests. Try again later.",
      retryable: true,
      retryAfter: "2030-01-02T03:04:05.000Z",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
  });

  it("does not revalidate semantic no-op preview and decision retries", async () => {
    mocks.preview.finalizePreview.mockResolvedValue({
      preview,
      changed: false,
    });
    mocks.preview.saveDecision.mockResolvedValue({ changed: false });

    await expect(
      finalizeActMigrationPreviewAction({
        runId,
        query: { page: 1, pageSize: 50 },
      }),
    ).resolves.toEqual({
      ok: true,
      changed: false,
      runId,
      preview,
    });
    await expect(
      saveActMigrationDecisionAction({
        runId,
        proposalKey: " proposal ",
        decision: "link_existing",
        chosenLocalEntityId: candidateId,
      }),
    ).resolves.toEqual({
      ok: true,
      changed: false,
      runId,
      proposalKey: "proposal",
    });
    expect(mocks.preview.saveDecision).toHaveBeenCalledWith({
      runId,
      proposalKey: "proposal",
      decision: "link_existing",
      chosenLocalEntityId: candidateId,
      decidedBy: "owner-user",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps Act API failures to static safe retry metadata", async () => {
    mocks.capture.captureNext.mockRejectedValue(
      new ActApiError("authentication_failed", false),
    );

    await expect(continueActMigrationAction(runId)).resolves.toEqual({
      ok: false,
      error:
        "Act! rejected the shared account credentials. Check the Render settings.",
      retryable: false,
      retryAfter: null,
    });
  });

  it("maps a missing decision run to the selected-run message", async () => {
    mocks.preview.saveDecision.mockRejectedValue(
      new ActMigrationRunNotFoundError(),
    );

    await expect(saveActMigrationDecisionAction({
      runId,
      proposalKey: "contact:missing-run",
      decision: "ignore",
      ignoreReason: "reviewed",
    })).resolves.toEqual({
      ok: false,
      error: "The selected Act! migration run was not found.",
      retryable: false,
      retryAfter: null,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      new ActMigrationLeaseConflictError(),
      "Another migration worker is finishing this page. Try again.",
      true,
    ],
    [
      new ActMigrationRunConflictError(),
      "That request key belongs to a different migration request.",
      false,
    ],
    [
      new ActMigrationRunNotFoundError(),
      "The selected Act! migration run was not found.",
      false,
    ],
    [
      new Error("contains secret details"),
      "The Act! migration could not be updated.",
      false,
    ],
  ])("maps typed and unknown failures to static copy", async (
    error,
    message,
    retryable,
  ) => {
    mocks.capture.captureNext.mockRejectedValue(error);

    await expect(continueActMigrationAction(runId)).resolves.toEqual({
      ok: false,
      error: message,
      retryable,
      retryAfter: null,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
