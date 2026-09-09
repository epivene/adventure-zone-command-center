import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveBackupWorkerLoop } from "./google-drive-backup-worker-loop";

describe("GoogleDriveBackupWorkerLoop", () => {
  afterEach(() => vi.useRealTimers());

  it("polls and closes cleanly", async () => {
    vi.useFakeTimers();
    const worker = { runOnce: vi.fn(async () => "idle" as const) };
    const loop = new GoogleDriveBackupWorkerLoop({ worker, idlePollMs: 20 });
    loop.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.runOnce).toHaveBeenCalledOnce();
    await loop.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(worker.runOnce).toHaveBeenCalledOnce();
  });
});
