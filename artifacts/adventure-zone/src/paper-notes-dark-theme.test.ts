import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync("src/appearance-themes.css", "utf8");

describe("paper notes dark theme", () => {
  it("overrides the shared paper-note accordions and review card in dark mode", () => {
    expect(themeCss).toContain('html.dark [data-testid^="paper-note-section-"]');
    expect(themeCss).toContain('html.dark article:has([data-testid^="paper-note-section-"])');
    expect(themeCss).toContain('background-color: hsl(var(--card)) !important;');
    expect(themeCss).toContain('color: hsl(var(--card-foreground)) !important;');
  });

  it("keeps paper-note secondary copy readable in dark mode", () => {
    expect(themeCss).toContain('html.dark article:has([data-testid^="paper-note-section-"]) .text-slate-500');
    expect(themeCss).toContain('color: hsl(var(--muted-foreground)) !important;');
  });
});
