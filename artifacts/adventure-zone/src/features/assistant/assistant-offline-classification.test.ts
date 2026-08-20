import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "assistant-api.ts"), "utf8");

describe("assistant offline classification", () => {
  it("only falls back to cached offline data for genuine fetch/network failures", () => {
    expect(source).toContain("isAssistantNetworkFailure");
    expect(source).toContain("cause instanceof TypeError");
    expect(source).toContain("if (!isAssistantNetworkFailure(networkError)) throw networkError");
  });

  it("does not classify API 500 responses as offline", () => {
    expect(source).not.toContain("catch (networkError) {\n    const cached = await getAssistantSnapshot");
  });
});
