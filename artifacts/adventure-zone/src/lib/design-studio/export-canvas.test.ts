import { afterEach, describe, expect, it, vi } from "vitest";
import { exportCanvasPdf, exportCanvasPng } from "./export-canvas";
import type { CanvasDocument } from "./model";

const emptyDoc: CanvasDocument = {
  version: 2,
  width: 320,
  height: 240,
  showGrid: false,
  gridSize: 16,
  zoom: 1,
  activePageId: "page-1",
  pages: [{
    id: "page-1",
    name: "Page 1",
    background: "#ffffff",
    nodes: [],
  }],
};

afterEach(() => vi.restoreAllMocks());

describe("Design Studio export", () => {
  it("creates a PDF blob with a PDF header", async () => {
    const pdf = await exportCanvasPdf(emptyDoc, []);
    expect(pdf.type).toBe("application/pdf");
    expect(await pdf.text()).toMatch(/^%PDF-1\.4/);
  });

  it("creates a PNG blob from the rendered canvas", async () => {
    const ctx = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "#fff",
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });

    const png = await exportCanvasPng(emptyDoc, []);
    expect(png.type).toBe("image/png");
  });
});
