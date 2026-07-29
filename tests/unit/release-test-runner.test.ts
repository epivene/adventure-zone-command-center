import { describe, expect, it } from "vitest";

import { runReleaseTests } from "@/scripts/run-release-tests";

describe("release test runner", () => {
  it("runs every release command in order with the inherited release environment", () => {
    const calls: Array<{
      executable: string;
      args: readonly string[];
      environment: NodeJS.ProcessEnv;
    }> = [];

    const status = runReleaseTests({
      environment: {
        KEEP_ME: "inherited",
        NODE_ENV: "test",
        npm_execpath: "C:\\tools\\npm-cli.js",
      },
      execPath: "C:\\tools\\node.exe",
      run: (executable, args, options) => {
        calls.push({
          executable,
          args: [...args],
          environment: options.env,
        });
        return { status: 0 };
      },
    });

    expect(status).toBe(0);
    expect(calls.map(({ executable, args }) => ({ executable, args }))).toEqual([
      {
        executable: "C:\\tools\\node.exe",
        args: ["C:\\tools\\npm-cli.js", "run", "test:crm-db"],
      },
      {
        executable: "C:\\tools\\node.exe",
        args: ["C:\\tools\\npm-cli.js", "run", "lint"],
      },
      {
        executable: "C:\\tools\\node.exe",
        args: ["C:\\tools\\npm-cli.js", "run", "typecheck"],
      },
      {
        executable: "C:\\tools\\node.exe",
        args: ["C:\\tools\\npm-cli.js", "test"],
      },
      {
        executable: "C:\\tools\\node.exe",
        args: [
          "C:\\tools\\npm-cli.js",
          "run",
          "test:e2e",
          "--",
          "tests/e2e/call-workspace.spec.ts",
          "tests/e2e/responsive.spec.ts",
          "tests/e2e/accessibility.spec.ts",
          "tests/e2e/booking-packages-resources.spec.ts",
          "tests/e2e/booking-flow.spec.ts",
        ],
      },
    ]);
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.environment).toMatchObject({
        CRM_RELEASE_TESTS: "1",
        KEEP_ME: "inherited",
        npm_execpath: "C:\\tools\\npm-cli.js",
      });
    }
  });

  it("returns the first failure and does not run later release commands", () => {
    let attempts = 0;

    const status = runReleaseTests({
      environment: {
        NODE_ENV: "test",
        npm_execpath: "/tools/npm-cli.js",
      },
      execPath: "/tools/node",
      run: () => {
        attempts += 1;
        return { status: attempts === 2 ? 23 : 0 };
      },
    });

    expect(status).toBe(23);
    expect(attempts).toBe(2);
  });
});
