import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-token", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from "@/lib/auth-token";
import { getLeadScoutRun } from "./lead-scout-api";

describe("getLeadScoutRun", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(apiGet).mockReset();
  });

  it("retries a transient browser fetch failure before surfacing an error", async () => {
    vi.useFakeTimers();
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ run: { id: "run-1", status: "running" } } as never);

    const pending = getLeadScoutRun("run-1");
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toMatchObject({ id: "run-1", status: "running" });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it("does not retry normal API/application errors", async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(getLeadScoutRun("run-1")).rejects.toThrow("Unauthorized");
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
