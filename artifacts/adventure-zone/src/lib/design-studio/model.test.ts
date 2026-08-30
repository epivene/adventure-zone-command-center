// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CANVAS_MODEL_VERSION,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_LETTER_SPACING,
  DEFAULT_LINE_HEIGHT,
  createDefaultCanvas,
  createImageNode,
  createShapeNode,
  createTextNode,
  expandGroupSelection,
  normalizeCanvas,
  type ImageNode,
  type ShapeNode,
  type TextNode,
} from "./model";

// ---------------------------------------------------------------------------
// normalizeCanvas — core behaviour
// ---------------------------------------------------------------------------

describe("normalizeCanvas – core", () => {
  it("returns a default canvas for null/garbage input", () => {
    const doc = normalizeCanvas(null);
    expect(doc.version).toBe(CANVAS_MODEL_VERSION);
    expect(doc.pages.length).toBe(1);
    expect(doc.width).toBe(DEFAULT_CANVAS_WIDTH);
    expect(doc.activePageId).toBe(doc.pages[0]!.id);
    expect(normalizeCanvas("not an object").pages.length).toBe(1);
    expect(normalizeCanvas(42).pages.length).toBe(1);
  });

  it("upgrades a legacy percentage-based structured canvas to absolute pixels", () => {
    const legacy = {
      activePageId: "page-1",
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          background: "hsl(var(--card))",
          elements: [
            {
              id: "text-1",
              kind: "text",
              label: "Headline",
              text: "Hello",
              x: 10,
              y: 20,
              width: 50,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              color: "hsl(var(--foreground))",
            },
          ],
        },
      ],
    };
    const doc = normalizeCanvas(legacy);
    expect(doc.version).toBe(CANVAS_MODEL_VERSION);
    const node = doc.pages[0]!.nodes[0]!;
    expect(node.kind).toBe("text");
    expect(node.name).toBe("Headline");
    expect(node.x).toBe(0.1 * DEFAULT_CANVAS_WIDTH);
    expect(node.y).toBe(0.2 * DEFAULT_CANVAS_HEIGHT);
    expect(node.width).toBe(0.5 * DEFAULT_CANVAS_WIDTH);
    expect(node.hidden).toBe(false);
    expect(node.groupId).toBeNull();
  });

  it("preserves an already-current absolute canvas without rescaling", () => {
    const current = createDefaultCanvas();
    current.pages[0]!.nodes[0]!.x = 300;
    current.pages[0]!.nodes[0]!.width = 400;
    const doc = normalizeCanvas(current);
    expect(doc.pages[0]!.nodes[0]!.x).toBe(300);
    expect(doc.pages[0]!.nodes[0]!.width).toBe(400);
  });

  it("falls back to first page when activePageId is invalid", () => {
    const doc = normalizeCanvas({
      activePageId: "missing",
      pages: [{ id: "real", name: "Real", nodes: [] }],
    });
    expect(doc.activePageId).toBe("real");
  });

  it("does NOT rescale a current v2 node whose coordinates are <= 100", () => {
    // Regression: a small/near-origin node in a v2 doc must be preserved
    // verbatim, never mistaken for legacy percentage data.
    const v2 = {
      version: CANVAS_MODEL_VERSION,
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
      activePageId: "p",
      pages: [
        {
          id: "p",
          name: "P",
          nodes: [
            {
              id: "tiny",
              kind: "shape",
              variant: "rectangle",
              x: 10,
              y: 20,
              width: 30,
              height: 40,
            },
          ],
        },
      ],
    };
    const node = normalizeCanvas(v2).pages[0]!.nodes[0]!;
    expect(node.x).toBe(10);
    expect(node.y).toBe(20);
    expect(node.width).toBe(30);
    expect(node.height).toBe(40);
  });

  it("survives a normalize -> normalize round trip without drift", () => {
    // Regression: normalizing an already-normalized v2 doc must be idempotent
    // for geometry (no repeated percentage rescaling).
    const once = normalizeCanvas({
      version: CANVAS_MODEL_VERSION,
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
      activePageId: "p",
      pages: [
        {
          id: "p",
          name: "P",
          nodes: [
            { id: "n1", kind: "shape", variant: "circle", x: 5, y: 8, width: 12, height: 12 },
            { id: "n2", kind: "text", x: 400, y: 300, width: 200, height: 60, text: "Hi" },
          ],
        },
      ],
    });
    const twice = normalizeCanvas(once);
    const g = (d: typeof once, id: string) => {
      const n = d.pages[0]!.nodes.find((x) => x.id === id)!;
      return { x: n.x, y: n.y, width: n.width, height: n.height };
    };
    expect(g(twice, "n1")).toEqual(g(once, "n1"));
    expect(g(twice, "n2")).toEqual(g(once, "n2"));
    // The <=100 node kept its raw coordinates on both passes.
    expect(g(twice, "n1")).toEqual({ x: 5, y: 8, width: 12, height: 12 });
  });

  it("only rescales legacy docs that use `elements` and predate v2", () => {
    // A doc with `nodes` and no version is NOT rescaled even if coords <= 100.
    const modernNoVersion = normalizeCanvas({
      pages: [
        {
          id: "p",
          nodes: [{ id: "n", kind: "shape", variant: "rectangle", x: 10, y: 10, width: 20, height: 20 }],
        },
      ],
    });
    expect(modernNoVersion.pages[0]!.nodes[0]!.x).toBe(10);

    // A doc with legacy `elements` and no version IS rescaled.
    const legacyElements = normalizeCanvas({
      pages: [
        {
          id: "p",
          elements: [{ id: "n", kind: "shape", variant: "rectangle", x: 10, y: 10, width: 20, height: 20 }],
        },
      ],
    });
    expect(legacyElements.pages[0]!.nodes[0]!.x).toBe(0.1 * DEFAULT_CANVAS_WIDTH);
  });

  it("clamps opacity and coerces malformed numbers", () => {
    const doc = normalizeCanvas({
      pages: [
        {
          id: "p",
          nodes: [
            {
              id: "s",
              kind: "shape",
              variant: "circle",
              x: 200,
              y: 200,
              width: 100,
              height: 100,
              opacity: 5,
              rotation: "bad",
            },
          ],
        },
      ],
    });
    const node = doc.pages[0]!.nodes[0]!;
    expect(node.opacity).toBe(1);
    expect(node.rotation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TextNode – new fields default and round-trip
// ---------------------------------------------------------------------------

describe("normalizeCanvas – TextNode new fields", () => {
  function rawText(extra: Record<string, unknown> = {}) {
    return {
      pages: [
        {
          id: "p",
          nodes: [
            {
              id: "t",
              kind: "text",
              x: 200,
              y: 200,
              width: 200,
              height: 60,
              text: "Hello",
              ...extra,
            },
          ],
        },
      ],
    };
  }

  it("assigns default fontFamily, italic, underline, letterSpacing, lineHeight when absent", () => {
    const doc = normalizeCanvas(rawText());
    const node = doc.pages[0]!.nodes[0]! as TextNode;
    expect(node.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(node.italic).toBe(false);
    expect(node.underline).toBe(false);
    expect(node.letterSpacing).toBe(DEFAULT_LETTER_SPACING);
    expect(node.lineHeight).toBe(DEFAULT_LINE_HEIGHT);
  });

  it("round-trips stored fontFamily, italic, underline, letterSpacing, lineHeight", () => {
    const doc = normalizeCanvas(
      rawText({
        fontFamily: "Georgia",
        italic: true,
        underline: true,
        letterSpacing: 50,
        lineHeight: 1.8,
      }),
    );
    const node = doc.pages[0]!.nodes[0]! as TextNode;
    expect(node.fontFamily).toBe("Georgia");
    expect(node.italic).toBe(true);
    expect(node.underline).toBe(true);
    expect(node.letterSpacing).toBe(50);
    expect(node.lineHeight).toBe(1.8);
  });

  it("rejects an unknown fontFamily and falls back to default", () => {
    const doc = normalizeCanvas(rawText({ fontFamily: "Comic Sans MS" }));
    const node = doc.pages[0]!.nodes[0]! as TextNode;
    expect(node.fontFamily).toBe(DEFAULT_FONT_FAMILY);
  });

  it("clamps lineHeight to 0.5–5 range", () => {
    const tooSmall = normalizeCanvas(rawText({ lineHeight: 0 }));
    expect((tooSmall.pages[0]!.nodes[0]! as TextNode).lineHeight).toBe(0.5);
    const tooBig = normalizeCanvas(rawText({ lineHeight: 99 }));
    expect((tooBig.pages[0]!.nodes[0]! as TextNode).lineHeight).toBe(5);
  });

  it("preserves existing text properties unchanged", () => {
    const original = createTextNode({
      fontFamily: "Georgia",
      italic: true,
      underline: true,
      letterSpacing: 25,
      lineHeight: 1.6,
    });
    const doc = normalizeCanvas({
      pages: [{ id: "p", nodes: [original] }],
    });
    const node = doc.pages[0]!.nodes[0]! as TextNode;
    expect(node.fontFamily).toBe("Georgia");
    expect(node.italic).toBe(true);
    expect(node.underline).toBe(true);
    expect(node.letterSpacing).toBe(25);
    expect(node.lineHeight).toBe(1.6);
  });
});

// ---------------------------------------------------------------------------
// ShapeNode – cornerRadius and flip
// ---------------------------------------------------------------------------

describe("normalizeCanvas – ShapeNode new fields", () => {
  function rawShape(extra: Record<string, unknown> = {}) {
    return {
      pages: [
        {
          id: "p",
          nodes: [
            {
              id: "s",
              kind: "shape",
              variant: "rectangle",
              x: 100,
              y: 100,
              width: 100,
              height: 80,
              ...extra,
            },
          ],
        },
      ],
    };
  }

  it("defaults cornerRadius, flipX, flipY when absent", () => {
    const doc = normalizeCanvas(rawShape());
    const node = doc.pages[0]!.nodes[0]! as ShapeNode;
    expect(node.cornerRadius).toBe(0);
    expect(node.flipX).toBe(false);
    expect(node.flipY).toBe(false);
  });

  it("round-trips cornerRadius and flip flags", () => {
    const doc = normalizeCanvas(rawShape({ cornerRadius: 12, flipX: true, flipY: true }));
    const node = doc.pages[0]!.nodes[0]! as ShapeNode;
    expect(node.cornerRadius).toBe(12);
    expect(node.flipX).toBe(true);
    expect(node.flipY).toBe(true);
  });

  it("clamps cornerRadius to 0–500", () => {
    const neg = normalizeCanvas(rawShape({ cornerRadius: -5 }));
    expect((neg.pages[0]!.nodes[0]! as ShapeNode).cornerRadius).toBe(0);
    const big = normalizeCanvas(rawShape({ cornerRadius: 9999 }));
    expect((big.pages[0]!.nodes[0]! as ShapeNode).cornerRadius).toBe(500);
  });

  it("factory includes all new shape fields", () => {
    const node = createShapeNode("rectangle");
    expect(node.cornerRadius).toBe(0);
    expect(node.flipX).toBe(false);
    expect(node.flipY).toBe(false);
  });

  it("factory overrides cornerRadius and flip", () => {
    const node = createShapeNode("rectangle", { cornerRadius: 8, flipX: true });
    expect(node.cornerRadius).toBe(8);
    expect(node.flipX).toBe(true);
    expect(node.flipY).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ImageNode – objectPosition and flip
// ---------------------------------------------------------------------------

describe("normalizeCanvas – ImageNode new fields", () => {
  function rawImage(extra: Record<string, unknown> = {}) {
    return {
      pages: [
        {
          id: "p",
          nodes: [
            {
              id: "i",
              kind: "image",
              x: 100,
              y: 100,
              width: 200,
              height: 150,
              ...extra,
            },
          ],
        },
      ],
    };
  }

  it("defaults objectPositionX/Y and flip flags when absent", () => {
    const doc = normalizeCanvas(rawImage());
    const node = doc.pages[0]!.nodes[0]! as ImageNode;
    expect(node.objectPositionX).toBe(50);
    expect(node.objectPositionY).toBe(50);
    expect(node.flipX).toBe(false);
    expect(node.flipY).toBe(false);
  });

  it("round-trips objectPosition and flip flags", () => {
    const doc = normalizeCanvas(
      rawImage({ objectPositionX: 20, objectPositionY: 80, flipX: true, flipY: false }),
    );
    const node = doc.pages[0]!.nodes[0]! as ImageNode;
    expect(node.objectPositionX).toBe(20);
    expect(node.objectPositionY).toBe(80);
    expect(node.flipX).toBe(true);
    expect(node.flipY).toBe(false);
  });

  it("clamps objectPosition to 0–100", () => {
    const doc = normalizeCanvas(rawImage({ objectPositionX: -10, objectPositionY: 110 }));
    const node = doc.pages[0]!.nodes[0]! as ImageNode;
    expect(node.objectPositionX).toBe(0);
    expect(node.objectPositionY).toBe(100);
  });

  it("factory includes all new image fields", () => {
    const node = createImageNode();
    expect(node.objectPositionX).toBe(50);
    expect(node.objectPositionY).toBe(50);
    expect(node.flipX).toBe(false);
    expect(node.flipY).toBe(false);
  });

  it("factory overrides objectPosition and flip", () => {
    const node = createImageNode({ objectPositionX: 30, flipY: true });
    expect(node.objectPositionX).toBe(30);
    expect(node.objectPositionY).toBe(50); // default
    expect(node.flipY).toBe(true);
  });

  it("strips signed and managed-asset URLs during normalization", () => {
    const signed = "https://storage.example/file?X-Goog-Signature=secret&X-Goog-Expires=900";
    const managed = normalizeCanvas(rawImage({ assetId: "asset-1", src: signed }));
    const external = normalizeCanvas(rawImage({
      assetId: null,
      src: "https://cdn.example/logo.png",
    }));

    expect(managed.pages[0]!.nodes[0]).toMatchObject({ assetId: "asset-1", src: null });
    expect(external.pages[0]!.nodes[0]).toMatchObject({
      assetId: null,
      src: "https://cdn.example/logo.png",
    });
  });
});

// ---------------------------------------------------------------------------
// expandGroupSelection
// ---------------------------------------------------------------------------

describe("expandGroupSelection", () => {
  it("expands a selection to all members of a group", () => {
    const a = createShapeNode("rectangle", { id: "a", groupId: "g1" });
    const b = createShapeNode("circle", { id: "b", groupId: "g1" });
    const c = createShapeNode("star", { id: "c", groupId: null });
    const page = { id: "p", name: "P", background: "", nodes: [a, b, c] };
    expect(expandGroupSelection(page, ["a"]).sort()).toEqual(["a", "b"]);
    expect(expandGroupSelection(page, ["c"])).toEqual(["c"]);
  });
});
