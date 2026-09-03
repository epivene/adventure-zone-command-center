import { afterEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/auth-token", () => ({ apiFetch }));

import { incomingCallingApi } from "./incoming-calling-api";

afterEach(() => {
  apiFetch.mockReset();
});

describe("incomingCallingApi", () => {
  it("accepts a successful voicemail handoff with no response body", async () => {
    apiFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      incomingCallingApi.sendToVoicemail("session-id"),
    ).resolves.toBeUndefined();
  });
});
