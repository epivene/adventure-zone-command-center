import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceRuntime } from "./runtime";
afterEach(() => vi.unstubAllEnvs());
it("keeps core assistant available when optional document credentials are malformed", () => {
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "invalid optional credentials");
  expect(createWorkspaceRuntime().ownerId).toBe("owner");
});
