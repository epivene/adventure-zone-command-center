import { describe, expect, it } from "vitest";

import { buildFailureInventory } from "./report-adventure-zone-test-failures";

describe("buildFailureInventory", () => {
  it("groups failed Windows test paths by application domain", () => {
    const report = {
      // Vitest counts nested describe suites here, not failed files.
      numFailedTestSuites: 3,
      // The inventory derives its test total from failed assertion results.
      numFailedTests: 5,
      testResults: [
        {
          name: "C:\\repo\\artifacts\\adventure-zone\\src\\pages\\TodayPage.test.tsx",
          status: "failed",
          assertionResults: [
            { status: "failed" },
            { status: "passed" },
          ],
        },
        {
          name: "C:\\repo\\artifacts\\adventure-zone\\src\\components\\calls\\call-workspace.test.tsx",
          status: "failed",
          assertionResults: [{ status: "failed" }],
        },
      ],
    };

    expect(
      buildFailureInventory(report, {
        node: "v22.23.2",
        platform: "win32",
      }),
    ).toEqual({
      runtime: { node: "v22.23.2", platform: "win32" },
      totals: { failedFiles: 2, failedTests: 2 },
      groups: [
        {
          domain: "components/calls",
          failedFiles: 1,
          failedTests: 1,
          files: ["src/components/calls/call-workspace.test.tsx"],
        },
        {
          domain: "pages",
          failedFiles: 1,
          failedTests: 1,
          files: ["src/pages/TodayPage.test.tsx"],
        },
      ],
    });
  });
});
