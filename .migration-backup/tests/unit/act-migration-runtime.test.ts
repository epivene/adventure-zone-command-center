import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RunNotFoundError extends Error {}
  return {
    RunNotFoundError,
    actClientConstructed: vi.fn(),
    actClientModuleLoaded: vi.fn(),
    applyRepositoryConstructed: vi.fn(),
    applyServiceConstructed: vi.fn(),
    applyOrganization: vi.fn(),
    applyContact: vi.fn(),
    applyOrganizationContact: vi.fn(),
    applyBooking: vi.fn(),
    applyBookingContact: vi.fn(),
    applyCallingList: vi.fn(),
    applyCallingListMember: vi.fn(),
    callingListApplyRepositoryConstructed: vi.fn(),
    captureServiceConstructed: vi.fn(),
    databaseModuleLoaded: vi.fn(),
    getActEnvironment: vi.fn(),
    getLatestProgress: vi.fn(),
    getPreviewIfStored: vi.fn(),
    getProgress: vi.fn(),
    entityApplyRepositoryConstructed: vi.fn(),
    localCandidatesConstructed: vi.fn(),
    previewRepositoryConstructed: vi.fn(),
    previewServiceConstructed: vi.fn(),
    relationshipApplyRepositoryConstructed: vi.fn(),
    snapshotRepositoryConstructed: vi.fn(),
    sourceClientConstructed: vi.fn(),
    sourceClientModuleLoaded: vi.fn(),
  };
});

vi.mock("@/lib/env", () => ({
  getActEnvironment: mocks.getActEnvironment,
}));
vi.mock("@/features/act-sync/act-client", () => {
  mocks.actClientModuleLoaded();
  return {
    ActClient: class {
      constructor(config: unknown) {
        mocks.actClientConstructed(config);
      }
    },
  };
});
vi.mock("@/features/act-migration/source-client", () => {
  mocks.sourceClientModuleLoaded();
  return {
    HttpActMigrationSourceClient: class {
      constructor(client: unknown) {
        mocks.sourceClientConstructed(client);
      }
    },
  };
});
vi.mock("@/features/act-migration/snapshot-repository", () => ({
  ActMigrationRunNotFoundError: mocks.RunNotFoundError,
  DrizzleActMigrationSnapshotRepository: class {
    constructor(database: unknown) {
      mocks.snapshotRepositoryConstructed(database);
    }

    getProgress(runId: string) {
      return mocks.getProgress(runId);
    }

    getLatestProgress() {
      return mocks.getLatestProgress();
    }
  },
}));
vi.mock("@/features/act-migration/preview-repository", () => ({
  DrizzleActMigrationPreviewRepository: class {
    constructor(database: unknown) {
      mocks.previewRepositoryConstructed(database);
    }

    getPreviewIfStored(runId: string, query: unknown) {
      return mocks.getPreviewIfStored(runId, query);
    }
  },
}));
vi.mock("@/features/act-migration/local-candidate-repository", () => ({
  DrizzleLocalCandidateRepository: class {
    constructor(database: unknown) {
      mocks.localCandidatesConstructed(database);
    }
  },
}));
vi.mock("@/features/act-migration/snapshot-service", () => ({
  ActMigrationSnapshotService: class {
    constructor(...dependencies: unknown[]) {
      mocks.captureServiceConstructed(...dependencies);
    }
  },
}));
vi.mock("@/features/act-migration/preview-service", () => ({
  ActMigrationPreviewService: class {
    constructor(...dependencies: unknown[]) {
      mocks.previewServiceConstructed(...dependencies);
    }
  },
}));
vi.mock("@/features/act-migration/apply-repository", () => ({
  DrizzleActMigrationApplyRepository: class {
    constructor(database: unknown) {
      mocks.applyRepositoryConstructed(database);
    }
  },
}));
vi.mock("@/features/act-migration/entity-apply-repository", () => ({
  MigrationEntityApplyRepository: class {
    constructor(database: unknown) {
      mocks.entityApplyRepositoryConstructed(database);
    }

    applyOrganization(operation: unknown) {
      return mocks.applyOrganization(operation);
    }

    applyContact(operation: unknown) {
      return mocks.applyContact(operation);
    }
  },
}));
vi.mock("@/features/act-migration/relationship-apply-repository", () => ({
  MigrationRelationshipApplyRepository: class {
    constructor(database: unknown) {
      mocks.relationshipApplyRepositoryConstructed(database);
    }

    applyOrganizationContact(operation: unknown) {
      return mocks.applyOrganizationContact(operation);
    }

    applyBooking(operation: unknown) {
      return mocks.applyBooking(operation);
    }

    applyBookingContact(operation: unknown) {
      return mocks.applyBookingContact(operation);
    }
  },
}));
vi.mock("@/features/act-migration/calling-list-apply-repository", () => ({
  MigrationCallingListApplyRepository: class {
    constructor(database: unknown) {
      mocks.callingListApplyRepositoryConstructed(database);
    }

    applyCallingList(operation: unknown) {
      return mocks.applyCallingList(operation);
    }

    applyMembership(operation: unknown) {
      return mocks.applyCallingListMember(operation);
    }
  },
}));
vi.mock("@/features/act-migration/apply-service", () => ({
  ActMigrationApplyService: class {
    constructor(...dependencies: unknown[]) {
      mocks.applyServiceConstructed(...dependencies);
    }
  },
}));

const runId = "11111111-1111-4111-8111-111111111111";
const query = { page: 1, pageSize: 25 };
const progress = {
  runId,
  status: "previewed",
  completedCheckpoints: 8,
  totalCheckpoints: 8,
  stagedRecords: 10,
  failedCheckpoints: 0,
  retryable: false,
  retryAfter: null,
  streams: [],
  interruption: null,
};
const preview = {
  runId,
  rows: [],
  report: {},
  page: 1,
  pageSize: 25,
  total: 0,
  entityCounts: {},
  stateCounts: {},
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("@/db/client", () => {
    mocks.databaseModuleLoaded();
    return { db: { kind: "database" } };
  });
  mocks.getActEnvironment.mockImplementation(() => {
    throw new Error("Act credentials must not be read");
  });
  mocks.getProgress.mockResolvedValue(progress);
  mocks.getLatestProgress.mockResolvedValue(progress);
  mocks.getPreviewIfStored.mockResolvedValue(preview);
});

describe("Act migration runtime", () => {
  it("loads the database only when called and keeps workspace reads DB-only", async () => {
    const { createActMigrationWorkspaceReader } = await import(
      "@/features/act-migration/runtime"
    );
    expect(mocks.databaseModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.snapshotRepositoryConstructed).not.toHaveBeenCalled();
    expect(mocks.previewRepositoryConstructed).not.toHaveBeenCalled();

    const reader = await createActMigrationWorkspaceReader();
    await expect(reader.getWorkspace({ runId, query })).resolves.toEqual({
      progress,
      preview,
      apply: {
        ready: undefined,
        summary: {
          approved: 0,
          pending: 0,
          blocked: 0,
          ignored: 0,
          applied: 0,
          failed: 0,
          bulkEligible: 0,
          byTarget: {},
        },
        byTarget: {},
        bulkEligible: 0,
      },
    });

    expect(mocks.databaseModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.getProgress).toHaveBeenCalledWith(runId);
    expect(mocks.getPreviewIfStored).toHaveBeenCalledWith(runId, query);
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
    expect(mocks.actClientModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.sourceClientModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.actClientConstructed).not.toHaveBeenCalled();
    expect(mocks.sourceClientConstructed).not.toHaveBeenCalled();
    expect(mocks.localCandidatesConstructed).not.toHaveBeenCalled();
    expect(mocks.captureServiceConstructed).not.toHaveBeenCalled();
    expect(mocks.previewServiceConstructed).not.toHaveBeenCalled();
  });

  it("keeps capture construction lazy until the capture factory is called", async () => {
    mocks.getActEnvironment.mockReturnValue({
      configured: true,
      config: {
        baseUrl: "https://apius.act.com/act.web.api",
        databaseName: "safe",
        username: "safe",
        password: "safe",
      },
    });
    const { createActMigrationCaptureService } = await import(
      "@/features/act-migration/runtime"
    );

    expect(mocks.databaseModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
    await createActMigrationCaptureService();

    expect(mocks.databaseModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.getActEnvironment).toHaveBeenCalledOnce();
    expect(mocks.actClientConstructed).toHaveBeenCalledOnce();
    expect(mocks.sourceClientConstructed).toHaveBeenCalledOnce();
    expect(mocks.captureServiceConstructed).toHaveBeenCalledOnce();
    expect(mocks.localCandidatesConstructed).not.toHaveBeenCalled();
    expect(mocks.previewServiceConstructed).not.toHaveBeenCalled();
  });

  it("keeps matcher construction lazy until the preview factory is called", async () => {
    const { createActMigrationPreviewService } = await import(
      "@/features/act-migration/runtime"
    );

    expect(mocks.databaseModuleLoaded).not.toHaveBeenCalled();
    await createActMigrationPreviewService();

    expect(mocks.databaseModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.localCandidatesConstructed).toHaveBeenCalledOnce();
    expect(mocks.previewServiceConstructed).toHaveBeenCalledOnce();
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
    expect(mocks.actClientConstructed).not.toHaveBeenCalled();
    expect(mocks.sourceClientConstructed).not.toHaveBeenCalled();
    expect(mocks.captureServiceConstructed).not.toHaveBeenCalled();
  });

  it("constructs apply from database-only targets without reading Act credentials", async () => {
    const { createActMigrationApplyService } = await import(
      "@/features/act-migration/runtime"
    );

    await createActMigrationApplyService();

    expect(mocks.databaseModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.applyRepositoryConstructed).toHaveBeenCalledOnce();
    expect(mocks.entityApplyRepositoryConstructed).toHaveBeenCalledOnce();
    expect(mocks.relationshipApplyRepositoryConstructed).toHaveBeenCalledOnce();
    expect(mocks.callingListApplyRepositoryConstructed).toHaveBeenCalledOnce();
    expect(mocks.applyServiceConstructed).toHaveBeenCalledOnce();
    const targets = mocks.applyServiceConstructed.mock.calls[0]?.[1] as
      Record<string, { apply: (operation: unknown) => Promise<unknown> }>;
    expect(Object.keys(targets)).toEqual([
      "organization",
      "contact",
      "organization_contact",
      "booking",
      "booking_contact",
      "calling_list",
      "calling_list_member",
    ]);
    await targets.organization?.apply({ id: "organization" });
    await targets.calling_list_member?.apply({ id: "membership" });
    expect(mocks.applyOrganization).toHaveBeenCalledWith({ id: "organization" });
    expect(mocks.applyCallingListMember).toHaveBeenCalledWith({ id: "membership" });
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
    expect(mocks.actClientConstructed).not.toHaveBeenCalled();
    expect(mocks.sourceClientConstructed).not.toHaveBeenCalled();
  });

  it("returns null for an empty latest-run read without touching previews", async () => {
    const { createActMigrationWorkspaceReader } = await import(
      "@/features/act-migration/runtime"
    );
    mocks.getLatestProgress.mockResolvedValueOnce(null);
    const reader = await createActMigrationWorkspaceReader();

    await expect(reader.getWorkspace({ query })).resolves.toBeNull();
    expect(mocks.getPreviewIfStored).not.toHaveBeenCalled();
    expect(mocks.getActEnvironment).not.toHaveBeenCalled();
  });

  it("converts only a typed explicit missing run to null", async () => {
    const { createActMigrationWorkspaceReader } = await import(
      "@/features/act-migration/runtime"
    );
    mocks.getProgress.mockRejectedValueOnce(new mocks.RunNotFoundError());
    const reader = await createActMigrationWorkspaceReader();

    await expect(reader.getWorkspace({ runId, query })).resolves.toBeNull();
    expect(mocks.getPreviewIfStored).not.toHaveBeenCalled();
  });
});
