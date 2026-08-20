import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync("src/components/event-families/manual-event-family-dialog.tsx", "utf8");
const picker = readFileSync("src/components/event-families/profile-member-picker.tsx", "utf8");

describe("manual event family dialog readability", () => {
  it("uses an opaque dialog surface with a distinct footer", () => {
    expect(dialog).toContain('className="bg-white text-slate-950 shadow-2xl');
    expect(dialog).toContain('data-testid="event-family-dialog-footer"');
    expect(dialog).toContain("border-t border-slate-200 bg-white");
  });

  it("renders search results as readable solid cards", () => {
    expect(picker).toContain("bg-white");
    expect(picker).toContain("rounded-xl border border-slate-200");
    expect(picker).toContain("border border-slate-200 bg-white");
  });
});
