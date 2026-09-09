import { describe, expect, it, vi } from "vitest";
import { GoogleDriveBackupWorker } from "./google-drive-backup-worker";

describe("GoogleDriveBackupWorker", () => {
  it("does nothing while disabled", async () => {
    const repository = { getConfig: vi.fn(async () => ({ state: "disabled", rootFolderId: null })) };
    const worker = new GoogleDriveBackupWorker({
      workerId: "worker",
      repository: repository as any,
      snapshots: {} as any,
      documents: {} as any,
      storage: {} as any,
      connections: {} as any,
    });
    await expect(worker.runOnce(new Date())).resolves.toBe("idle");
    expect(repository.getConfig).toHaveBeenCalledOnce();
  });

  it("marks a missing profile source removed without touching Drive", async () => {
    const job = { id: "job", entityKind: "profile_summary", entityId: "entity", requestGeneration: 1, claimedGeneration: 1, attempts: 1, priority: 100 };
    const repository = {
      getConfig: vi.fn(async () => ({ state: "active", rootFolderId: "root", connectionId: "connection" })),
      claimNext: vi.fn(async () => job),
      markSourceRemoved: vi.fn(async () => undefined),
    };
    const connections = { createDriveBackupClient: vi.fn() };
    const worker = new GoogleDriveBackupWorker({
      workerId: "worker", repository: repository as any,
      snapshots: { getProfileSnapshot: vi.fn(async () => null) } as any,
      documents: {} as any, storage: {} as any, connections,
    });
    await expect(worker.runOnce(new Date("2026-09-09T00:00:00Z"))).resolves.toBe("skipped");
    expect(repository.markSourceRemoved).toHaveBeenCalledWith(job, expect.any(Date));
    expect(connections.createDriveBackupClient).not.toHaveBeenCalled();
  });
});
