import { describe, expect, it, vi } from "vitest";
import { PostgresGoogleDriveBackupRepository } from "./google-drive-backup-repository";

describe("PostgresGoogleDriveBackupRepository", () => {
  it("claims the highest priority eligible job with a lease", async () => {
    const query = vi.fn(async () => ({ rows: [{
      id: "job-1", entity_kind: "profile_summary", entity_id: "entity-1",
      request_generation: "3", claimed_generation: "3", attempts: 2, priority: 100,
    }] }));
    const repository = new PostgresGoogleDriveBackupRepository({ query });
    await expect(repository.claimNext("worker-1", new Date("2026-09-09T00:00:00Z")))
      .resolves.toMatchObject({ id: "job-1", claimedGeneration: 3 });
    expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(query.mock.calls[0]?.[0]).toContain("priority DESC");
  });

  it("requeues completion when another mutation changed the generation", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresGoogleDriveBackupRepository({ query });
    await repository.markSucceeded("job-1", 4, new Date("2026-09-09T00:00:00Z"));
    expect(query.mock.calls[0]?.[0]).toContain("request_generation = $2");
    expect(query.mock.calls[0]?.[0]).toContain("ELSE 'queued'");
  });
});
