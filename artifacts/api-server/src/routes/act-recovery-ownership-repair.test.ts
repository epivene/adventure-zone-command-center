import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ACT ownership repair rerun", () => {
  it("exposes a dedicated ownership-repair route with a fresh request key and timeline-only streams", () => {
    const route = readFileSync(new URL("./act-recovery.ts", import.meta.url), "utf8");
    const service = readFileSync(new URL("../features/act-recovery/ownership-repair-service.ts", import.meta.url), "utf8");

    expect(route).toContain('/act-recovery/ownership-repair');
    expect(service).toContain('act-note-ownership-repair:');
    expect(service).toContain('randomUUID()');
    expect(service).toContain('streamTypes: ["note", "history", "activity"]');
  });
});
