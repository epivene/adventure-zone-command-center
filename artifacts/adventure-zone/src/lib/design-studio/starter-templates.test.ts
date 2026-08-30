import { describe, expect, it } from "vitest";
import { createStarterCanvas, starterContent } from "./starter-templates";

describe("Design Studio starter templates", () => {
  it.each(["flyer", "social post", "brochure"] as const)(
    "creates a populated freeform %s canvas",
    (type) => {
      const canvas = createStarterCanvas(type);
      const page = canvas.pages[0]!;

      expect(page.nodes.length).toBeGreaterThanOrEqual(5);
      expect(page.nodes.some((node) => node.kind === "text")).toBe(true);
      expect(page.nodes.some((node) => node.kind === "shape")).toBe(true);
    },
  );

  it.each(["email", "review request", "contract"] as const)(
    "supplies structured copy for %s",
    (type) => {
      expect(starterContent(type)?.trim()).toBeTruthy();
    },
  );
});