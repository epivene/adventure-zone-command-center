import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const routeIndexUrl = new URL("./index.ts", import.meta.url);

describe("owner API opportunity email runtime mount", () => {
  it("mounts the live email runtime only after owner authentication middleware", async () => {
    const source = await readFile(routeIndexUrl, "utf8");
    expect(source).toContain('import opportunityEmailLiveRuntimeRouter from "./opportunity-email-live-runtime"');

    const ownerMiddlewareIndex = source.indexOf("router.use(requireOwnerMiddleware)");
    const emailMountIndex = source.indexOf("router.use(opportunityEmailLiveRuntimeRouter)");
    expect(ownerMiddlewareIndex).toBeGreaterThanOrEqual(0);
    expect(emailMountIndex).toBeGreaterThan(ownerMiddlewareIndex);
  });
});
