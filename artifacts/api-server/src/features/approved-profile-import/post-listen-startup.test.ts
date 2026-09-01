import { describe, expect, it, vi } from "vitest";

import { APPROVED_PROFILE_STARTUP_TIMEOUT_MS } from "./startup-config";
import { runMaintenanceAndStartWorkers } from "./post-listen-startup";

describe("post-listen startup", () => {
  it("allows the approved profile import enough time to finish", () => {
    expect(APPROVED_PROFILE_STARTUP_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it("starts background workers after maintenance fails", async () => {
    const maintenanceError = new Error("maintenance failed");
    const onMaintenanceError = vi.fn();
    const startBackgroundWorkers = vi.fn().mockResolvedValue(undefined);

    await runMaintenanceAndStartWorkers({
      runMaintenance: async () => {
        throw maintenanceError;
      },
      onMaintenanceError,
      startBackgroundWorkers,
    });

    expect(onMaintenanceError).toHaveBeenCalledWith(maintenanceError);
    expect(startBackgroundWorkers).toHaveBeenCalledTimes(1);
  });
});
