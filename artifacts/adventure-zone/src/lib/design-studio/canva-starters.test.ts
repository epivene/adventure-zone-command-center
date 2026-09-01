import { describe, expect, it } from "vitest";
import { CANVA_STARTERS, starterById } from "./canva-starters";
import { normalizeCanvas } from "./model";

describe("Adventure Zone canvas starters", () => {
  it("ships five starters with editable canvas documents", () => {
    expect(CANVA_STARTERS).toHaveLength(5);

    for (const starter of CANVA_STARTERS) {
      const canvas = normalizeCanvas(starter.canvas);
      expect(canvas.pages).toHaveLength(1);
      expect(canvas.pages[0]!.nodes.length).toBeGreaterThan(4);
      expect(canvas.pages[0]!.nodes.some((node) => node.kind === "text")).toBe(true);
    }
  });

  it("event flyer contains editable image and shape layers", () => {
    const starter = starterById("event-flyer");
    expect(starter).toBeDefined();
    const nodes = starter!.canvas.pages[0]!.nodes;
    expect(nodes.some((node) => node.kind === "image")).toBe(true);
    expect(nodes.some((node) => node.kind === "shape")).toBe(true);
  });

  it("every starter has a valid active page", () => {
    for (const starter of CANVA_STARTERS) {
      expect(starter.canvas.pages.some((page) => page.id === starter.canvas.activePageId)).toBe(true);
    }
  });
});
