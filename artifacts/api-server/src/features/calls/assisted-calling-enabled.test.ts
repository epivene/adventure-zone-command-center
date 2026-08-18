import { describe, expect, it } from "vitest";
import { isAssistedCallingEnabled } from "./assisted-calling-enabled";

describe("isAssistedCallingEnabled", () => {
  it("stays disabled when the deployment flag is missing", () => {
    expect(isAssistedCallingEnabled(undefined)).toBe(false);
  });

  it("stays disabled for an explicit false flag", () => {
    expect(isAssistedCallingEnabled("false")).toBe(false);
  });

  it("enables assisted calling only for an explicit true flag", () => {
    expect(isAssistedCallingEnabled("true")).toBe(true);
  });
});
