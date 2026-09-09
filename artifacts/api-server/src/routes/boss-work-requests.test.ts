import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(path.resolve(process.cwd(), "src/routes", name), "utf8");

describe("Boss work request route boundaries", () => {
  it("requires Boss authentication on every Dave endpoint", () => {
    const routes = source("boss-work-requests.ts");
    expect(routes.match(/requireBoss/g)?.length).toBeGreaterThanOrEqual(6);
    expect(routes).toContain('"/boss/work-requests"');
    expect(routes).toContain("req.bossAccount!.accountId");
  });

  it("mounts Dave routes before the owner gate and Owner routes after it", () => {
    const index = source("index.ts");
    expect(index.indexOf("router.use(bossWorkRequestsRouter)")).toBeLessThan(index.indexOf("router.use(requireOwnerMiddleware)"));
    expect(index.indexOf("router.use(bossWorkRequestsOwnerRouter)")).toBeGreaterThan(index.indexOf("router.use(requireOwnerMiddleware)"));
  });
});
