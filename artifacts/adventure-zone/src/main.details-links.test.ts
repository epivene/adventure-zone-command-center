import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mainSource = fs.readFileSync(path.join(process.cwd(), "src/main.tsx"), "utf8");

describe("same-page details links", () => {
  it("opens a targeted details panel before scrolling it into view", () => {
    expect(mainSource).toContain("target instanceof HTMLDetailsElement");
    expect(mainSource).toContain("target.open = true");
    expect(mainSource).toContain("target.scrollIntoView");
  });
});
