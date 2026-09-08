import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "index.ts"), "utf8");

describe("API startup order", () => {
  it("keeps API traffic gated until required schema startup completes", () => {
    const starting = source.indexOf("markAppStarting();");
    const listen = source.indexOf("app.listen(");
    const requiredSchema = source.indexOf("runRequiredSchemaStartup();");
    const ready = source.indexOf("markAppReady();");

    expect(starting).toBeGreaterThan(-1);
    expect(starting).toBeLessThan(listen);
    expect(listen).toBeLessThan(requiredSchema);
    expect(requiredSchema).toBeLessThan(ready);
  });

  it("keeps background workers behind post-listen maintenance", () => {
    expect(source.indexOf("runPostListenMaintenance")).toBeLessThan(
      source.indexOf("leadScoutLoop.start()"),
    );
  });
});
