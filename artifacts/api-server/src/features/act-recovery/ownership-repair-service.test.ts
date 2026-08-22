import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ActOwnershipRepairService", () => {
  it("creates a fresh timeline-only run rather than reusing the completed full recovery key", () => {
    const source = readFileSync(new URL("./ownership-repair-service.ts", import.meta.url), "utf8");
    expect(source).toContain("act-note-ownership-repair:");
    expect(source).toContain("randomUUID()");
    expect(source).toContain('streamTypes: ["note", "history", "activity"]');
    expect(source).not.toContain("archive-full-recovery-v3-history-html-text");
  });
});
