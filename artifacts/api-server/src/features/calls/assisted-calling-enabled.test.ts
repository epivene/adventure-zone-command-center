import { describe, expect, it } from "vitest";
import { isAssistedCallingEnabled } from "./assisted-calling-enabled";

describe("isAssistedCallingEnabled", () => {
  it("keeps assisted calling available when the deployment flag is missing", () => {
    expect(isAssistedCallingEnabled(undefined)).toBe(true);
  });

  it("still allows an explicit false flag to disable assisted calling", () => {
    expect(isAssistedCallingEnabled("false")).toBe(false);
  });
});
