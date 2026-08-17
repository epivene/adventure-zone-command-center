import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ACT recovery request version", () => {
  it("starts a fresh v3 pass for stored history HTML cleanup", () => {
    const path = fileURLToPath(new URL("./act-recovery-client.ts", import.meta.url));
    const source = readFileSync(path, "utf8");

    expect(source).toContain('requestKey: "archive-full-recovery-v3-history-html-text"');
  });
});
