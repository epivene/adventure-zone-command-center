import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const script = path.resolve(__dirname, "enforce-pnpm.mjs");

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryWorkspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "adventure-zone-pnpm-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "package-lock.json"), "{}");
  writeFileSync(path.join(directory, "yarn.lock"), "");
  return directory;
}

function environmentWithUserAgent(userAgent: string) {
  return Object.fromEntries([
    ...Object.entries(process.env).filter(
      ([key]) => key.toLowerCase() !== "npm_config_user_agent",
    ),
    ["npm_config_user_agent", userAgent],
  ]);
}

describe("enforce pnpm install", () => {
  it("accepts pnpm and removes conflicting lockfiles", () => {
    const cwd = temporaryWorkspace();
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      env: environmentWithUserAgent(
        "pnpm/10.33.4 npm/? node/v22.23.2 win32 x64",
      ),
    });

    expect(
      result.status,
      JSON.stringify({
        executable: process.execPath,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error?.message,
      }),
    ).toBe(0);
    expect(existsSync(path.join(cwd, "package-lock.json"))).toBe(false);
    expect(existsSync(path.join(cwd, "yarn.lock"))).toBe(false);
  });

  it("rejects non-pnpm installers", () => {
    const cwd = temporaryWorkspace();
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      env: environmentWithUserAgent(
        "npm/11.0.0 node/v22.23.2 win32 x64",
      ),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use pnpm instead");
  });
});
