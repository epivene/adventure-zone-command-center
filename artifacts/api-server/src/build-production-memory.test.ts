import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("production API build memory safety", () => {
  it("does not emit a linked source map unless it is explicitly requested", () => {
    const safeEnvironment = { ...process.env };
    delete safeEnvironment.NODE_ENV;
    delete safeEnvironment.API_SOURCE_MAPS;
    execFileSync(process.execPath, ["./build.mjs"], {
      cwd: process.cwd(),
      env: safeEnvironment,
      stdio: "pipe",
    });

    expect(existsSync(path.resolve(process.cwd(), "dist/index.mjs.map"))).toBe(false);
  });
});
