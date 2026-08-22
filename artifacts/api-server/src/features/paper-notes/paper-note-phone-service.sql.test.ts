import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/paper-notes/paper-note-phone-service.ts", "utf8");

describe("PaperNotePhoneService SQL", () => {
  it("quotes the reserved primary column in raw PostgreSQL statements", () => {
    expect(source).toContain('status, "primary", source');
    expect(source).toContain('returning id, "primary"');
    expect(source).toContain('set status = \'inactive\', "primary" = false');
    expect(source).toContain('set "primary" = false');
    expect(source).toContain('and "primary" = true');

    expect(source).not.toMatch(/\bstatus, primary, source\b/);
    expect(source).not.toMatch(/\breturning id, primary\b/);
    expect(source).not.toMatch(/\bset primary = false\b/);
    expect(source).not.toMatch(/\band primary = true\b/);
  });
});
