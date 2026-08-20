import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/features/paper-notes/paper-note-review-schema.ts",
  "src/routes/paper-note-extraction.ts",
  "src/routes/paper-note-import.ts",
  "src/routes/paper-note-matching.ts",
  "src/routes/paper-note-review.ts",
  "src/routes/paper-note-source.ts",
] as const;

describe("paper note zod imports", () => {
  it("imports zod through the API build alias instead of double-addressing zod/v4", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain('from "zod/v4"');
      expect(source, file).toContain('from "zod"');
    }
  });
});
