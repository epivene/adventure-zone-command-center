import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(here, "index.ts"), "utf8");

function localRouteImports(source: string) {
  return [...source.matchAll(/from\s+["'](\.\/.+?)["']/g)].map((match) => match[1]!);
}

describe("route index local imports", () => {
  it("resolves every local route module referenced by index.ts", () => {
    const missing = localRouteImports(indexSource).filter((specifier) => {
      const base = resolve(here, specifier);
      return !existsSync(`${base}.ts`) && !existsSync(`${base}.tsx`) && !existsSync(resolve(base, "index.ts"));
    });

    expect(missing).toEqual([]);
  });

  it("uses the actual manager travel admin module name", () => {
    expect(indexSource).toContain('from "./manager-travel-admin"');
    expect(indexSource).not.toContain('from "./leg-manager-travel-admin"');
  });

  it("mounts anonymous inquiry intake before the owner-only gate", () => {
    const intakeAt = indexSource.indexOf("router.use(publicWebsiteInquiriesRouter)");
    const ownerAt = indexSource.indexOf("router.use(requireOwnerMiddleware)");
    expect(intakeAt).toBeGreaterThan(-1);
    expect(intakeAt).toBeLessThan(ownerAt);
  });
});
