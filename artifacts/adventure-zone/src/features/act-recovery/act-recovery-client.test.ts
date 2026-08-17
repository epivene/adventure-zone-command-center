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

  it("starts the v3 HTML cleanup rules instead of replaying the completed v2 run", async () => {
    auth.apiPost.mockResolvedValue({ complete: false });

    await startRecovery();

    expect(auth.apiPost).toHaveBeenCalledWith("/act-recovery/runs", {
      requestKey: "archive-full-recovery-v3-history-html-text",
    });
  });
});
