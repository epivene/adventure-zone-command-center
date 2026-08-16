import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ACT extraction runtime memory policy", () => {
  it("uses one extraction worker on the small production service", () => {
    const runtimePath = fileURLToPath(new URL("./runtime.ts", import.meta.url));
    const source = readFileSync(runtimePath, "utf8");

    expect(source).toContain("export const actExtractionWorkerConcurrency = 1;");
  });
});
