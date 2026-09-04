import { describe, expect, it, vi } from "vitest";

import { APPROVED_PROFILE_STARTUP_TIMEOUT_MS } from "./startup-config";
import { runMaintenanceAndStartWorkers } from "./post-listen-startup";

describe("post-listen startup", () => {
  it("allows the approved profile import enough time to finish", () => {
    expect(APPROVED_PROFILE_STARTUP_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it("opens readiness before maintenance and starts workers after maintenance fails", async () => {
    const maintenanceError = new Error("maintenance failed");
    const onMaintenanceError = vi.fn();
    const events: string[] = [];
    const startBackgroundWorkers = vi.fn(async () => {
      events.push("workers");
    });

    await runMaintenanceAndStartWorkers({
      runMaintenance: async () => {
        events.push("maintenance");
        throw maintenanceError;
      },
      onMaintenanceError,
      onReady: () => {
        events.push("ready");
      },
      startBackgroundWorkers,
    });

    expect(onMaintenanceError).toHaveBeenCalledWith(maintenanceError);
    expect(events).toEqual(["ready", "maintenance", "workers"]);
    expect(startBackgroundWorkers).toHaveBeenCalledTimes(1);
    expect(events.indexOf("ready")).toBeLessThan(
      events.indexOf("workers"),
    );
  });

  it("opens readiness before successful maintenance and workers", async () => {
    const events: string[] = [];

    await runMaintenanceAndStartWorkers({
      runMaintenance: async () => {
        events.push("maintenance");
      },
      onMaintenanceError: vi.fn(),
      onReady: () => {
        events.push("ready");
      },
      startBackgroundWorkers: async () => {
        events.push("workers");
      },
    });

    expect(events).toEqual(["ready", "maintenance", "workers"]);
  });
});
