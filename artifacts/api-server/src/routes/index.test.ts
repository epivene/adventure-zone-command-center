import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("API router registration", () => {
  it("mounts manager auth and manager data before owner auth, and manager admin after owner auth", () => {
    const managerAuth = source.indexOf("router.use(managerAuthRouter)");
    const managerData = source.indexOf("router.use(managerRouter)");
    const ownerAuth = source.indexOf("router.use(requireOwnerMiddleware)");
    const managerAdmin = source.indexOf("router.use(managerAdminRouter)");

    expect(managerAuth).toBeGreaterThan(-1);
    expect(managerData).toBeGreaterThan(-1);
    expect(managerAdmin).toBeGreaterThan(-1);
    expect(managerAuth).toBeLessThan(ownerAuth);
    expect(managerData).toBeLessThan(ownerAuth);
    expect(managerAdmin).toBeGreaterThan(ownerAuth);
  });
});
