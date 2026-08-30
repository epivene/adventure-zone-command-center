import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Design Studio route ordering", () => {
  it("mounts the dual-role Studio router before the owner-only middleware", () => {
    const routes = readFileSync(path.resolve(process.cwd(), "src/routes/index.ts"), "utf8");

    expect(routes.indexOf("router.use(officeDesignStudioRouter)")).toBeGreaterThan(-1);
    expect(routes.indexOf("router.use(officeDesignStudioRouter)")).toBeLessThan(
      routes.indexOf("router.use(requireOwnerMiddleware)"),
    );
  });
});