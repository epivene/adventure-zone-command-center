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

  it("uses the current $8,000 Pirate and Warrior prices in the package one-sheet", () => {
    const starter = starterById("package-overview");
    expect(starter).toBeDefined();
    expect(starter!.content).toContain("PIRATE'S REBELLION — $8,000 / 1–4 DAYS");
    expect(starter!.content).toContain("WARRIOR'S PLAYGROUND — $8,000 / 1–4 DAYS");

    const priceNodes = starter!.canvas.pages[0]!.nodes
      .filter((node) => node.kind === "text" && ["pk-price-pirate", "pk-price-warrior"].includes(node.id));
    expect(priceNodes.map((node) => node.kind === "text" ? node.text : null)).toEqual([
      "$8,000",
      "$8,000",
    ]);
  });
});
