import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ACT ownership repair rerun", () => {
  it("exposes a dedicated ownership-repair route with a fresh request key and timeline-only streams", () => {
    const source = readFileSync(new URL("./act-recovery.ts", import.meta.url), "utf8");

    expect(source).toContain('/act-recovery/ownership-repair');
    expect(source).toContain('act-note-ownership-repair:');
    expect(source).toContain('randomUUID()');
    expect(source).toContain('streamTypes: ["note", "history", "activity"]');
  });
});
