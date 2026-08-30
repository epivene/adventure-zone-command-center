import { describe, expect, it } from "vitest";
import { sanitizeDesignStudioCanvas } from "./canvas-sanitizer";

describe("sanitizeDesignStudioCanvas", () => {
  it("removes signed and managed-asset URLs before persistence", () => {
    const result = sanitizeDesignStudioCanvas({
      pages: [{
        nodes: [
          { kind: "image", assetId: "asset-1", src: "https://storage/file?X-Goog-Signature=secret" },
          { kind: "image", assetId: null, src: "https://cdn.example/logo.png" },
          { kind: "text", text: "Keep me" },
        ],
      }],
    });
    const nodes = ((result.pages as Array<{ nodes: Array<Record<string, unknown>> }>)[0]!.nodes);
    expect(nodes[0]!.src).toBeNull();
    expect(nodes[1]!.src).toBe("https://cdn.example/logo.png");
    expect(nodes[2]!.text).toBe("Keep me");
  });
});