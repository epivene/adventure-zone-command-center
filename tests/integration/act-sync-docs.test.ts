import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const actVariables = [
  "ACT_API_BASE_URL",
  "ACT_DATABASE_NAME",
  "ACT_USERNAME",
  "ACT_PASSWORD",
];

async function text(file: string) {
  return readFile(path.join(root, file), "utf8");
}

describe("Act sync operations documentation", () => {
  it("documents every server-only Act environment variable without values", async () => {
    const [example, deployment, runbook] = await Promise.all([
      text(".env.example"),
      text("docs/operations/deployment.md"),
      text("docs/operations/act-sync.md"),
    ]);

    for (const variable of actVariables) {
      expect(example).toContain(`${variable}=`);
      expect(deployment).toContain(variable);
      expect(runbook).toContain(variable);
    }
    expect(example).not.toMatch(/ACT_(?:DATABASE_NAME|USERNAME|PASSWORD)=.+/);
  });

  it("declares Act credentials as unsynchronized Render secrets", async () => {
    const blueprint = await text("render.yaml");

    for (const variable of [
      "ACT_DATABASE_NAME",
      "ACT_USERNAME",
      "ACT_PASSWORD",
    ]) {
      expect(blueprint).toMatch(
        new RegExp(`key: ${variable}\\s+sync: false`),
      );
    }
  });

  it("covers safe operation and recovery paths", async () => {
    const runbook = await text("docs/operations/act-sync.md");

    expect(runbook).toMatch(/Test connection/i);
    expect(runbook).toMatch(/preview/i);
    expect(runbook).toMatch(/Apply approved/i);
    expect(runbook).toMatch(/partial|interrupted/i);
    expect(runbook).toMatch(/rotate|rotation/i);
    expect(runbook).toMatch(/401/);
    expect(runbook).toMatch(/4032/);
    expect(runbook).toMatch(/429/);
    expect(runbook).toMatch(/XLS/i);
  });
});
