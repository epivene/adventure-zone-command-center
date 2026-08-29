import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const serverIndexUrl = new URL("../../index.ts", import.meta.url);

describe("scheduled opportunity email server lifecycle", () => {
  it("starts the email worker after maintenance and closes it during shutdown", async () => {
    const source = await readFile(serverIndexUrl, "utf8");

    expect(source).toContain(
      'import { createOpportunityEmailWorkerLoop } from "./features/opportunity-email/opportunity-email-worker-runtime"',
    );
    expect(source).toContain("let opportunityEmailLoop:");
    expect(source).toContain("opportunityEmailLoop?.close()");
    expect(source).toContain("opportunityEmailLoop = await createOpportunityEmailWorkerLoop()");
    expect(source).toContain("opportunityEmailLoop.start()");
    expect(source).toContain("Opportunity email scheduled-send worker could not be started");

    const backgroundStart = source.indexOf("async function startBackgroundWorkers()");
    const createLoop = source.indexOf("opportunityEmailLoop = await createOpportunityEmailWorkerLoop()", backgroundStart);
    expect(backgroundStart).toBeGreaterThanOrEqual(0);
    expect(createLoop).toBeGreaterThan(backgroundStart);
  });
});
