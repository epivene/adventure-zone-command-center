import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => auth);

import { startRecovery } from "./act-recovery-client";

describe("ACT recovery client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts the v2 recovery rules instead of replaying the completed v1 run", async () => {
    auth.apiPost.mockResolvedValue({ complete: false });

    await startRecovery();

    expect(auth.apiPost).toHaveBeenCalledWith("/act-recovery/runs", {
      requestKey: "archive-full-recovery-v2-inline-history",
    });
  });
});
