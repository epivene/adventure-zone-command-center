import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ACT note ownership repair v2 startup", () => {
  it("schedules a timeline-only v2 repair run", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../act-replacement/runtime.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain('requestKey: "act-note-profile-repair-v2"');
    expect(source).toContain('streamTypes: ["note", "history", "activity"]');
  });
});
